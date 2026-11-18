-- Atomic account creation and referral registration for the Supabase Edge API.
CREATE OR REPLACE FUNCTION platform.create_user_atomic(
  p_actor_id uuid, p_username text, p_email text, p_password_hash text,
  p_role public.user_role_enum, p_initial_tokens bigint DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_actor record; v_user record; v_source uuid; v_target uuid;
  v_wallet_type public.wallet_type_enum; v_tx_type public.transaction_type_enum;
  v_referral text;
BEGIN
  IF p_actor_id IS NULL OR p_username IS NULL OR length(trim(p_username)) NOT BETWEEN 3 AND 64
    OR p_email IS NULL OR position('@' in p_email)=0 OR length(p_email)>254
    OR p_password_hash IS NULL OR length(p_password_hash)<20
    OR p_initial_tokens<0 OR p_initial_tokens>9007199254740991 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  SELECT u.id,ra.role INTO v_actor FROM platform.users u
  JOIN platform.role_assignments ra ON ra.user_id=u.id
  WHERE u.id=p_actor_id AND u.is_active FOR UPDATE OF u;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTOR_NOT_FOUND' USING ERRCODE='42501'; END IF;
  IF NOT ((v_actor.role='OWNER' AND p_role='SUPER_ADMIN') OR
          (v_actor.role='SUPER_ADMIN' AND p_role='ADMIN') OR
          (v_actor.role='ADMIN' AND p_role='PLAYER')) THEN
    RAISE EXCEPTION 'ROLE_HIERARCHY_VIOLATION' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM platform.users WHERE lower(username)=lower(trim(p_username)) OR lower(email)=lower(trim(p_email))) THEN
    RAISE EXCEPTION 'DUPLICATE_ACCOUNT' USING ERRCODE='23505';
  END IF;
  INSERT INTO platform.users(username,email,password_hash,parent_id)
  VALUES(trim(p_username),lower(trim(p_email)),p_password_hash,p_actor_id)
  RETURNING id,username,email,parent_id,referred_by_user_id,is_active INTO v_user;
  INSERT INTO platform.role_assignments(user_id,role,assigned_by) VALUES(v_user.id,p_role,p_actor_id);
  v_wallet_type := CASE p_role WHEN 'SUPER_ADMIN' THEN 'SUPER_ADMIN'::public.wallet_type_enum
    WHEN 'ADMIN' THEN 'ADMIN'::public.wallet_type_enum ELSE 'PLAYER'::public.wallet_type_enum END;
  INSERT INTO wallet.wallets(user_id,wallet_type,balance) VALUES(v_user.id,v_wallet_type,0) RETURNING id INTO v_target;
  INSERT INTO platform.user_profiles(user_id,display_name) VALUES(v_user.id,v_user.username);
  IF p_role='PLAYER' THEN
    v_referral := 'BD'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
    INSERT INTO platform.referral_codes(code,owner_user_id,admin_id,is_active) VALUES(v_referral,v_user.id,p_actor_id,true);
  END IF;
  IF p_initial_tokens>0 THEN
    IF v_actor.role='OWNER' THEN
      SELECT id INTO v_source FROM wallet.wallets WHERE wallet_type='TREASURY' LIMIT 1 FOR UPDATE;
      v_tx_type := 'TREASURY_TO_ROLE';
    ELSE
      SELECT id INTO v_source FROM wallet.wallets WHERE user_id=p_actor_id LIMIT 1 FOR UPDATE;
      v_tx_type := CASE v_actor.role WHEN 'SUPER_ADMIN' THEN 'ROLE_TO_ROLE'::public.transaction_type_enum ELSE 'ROLE_TO_PLAYER'::public.transaction_type_enum END;
    END IF;
    IF v_source IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE='P0001'; END IF;
    PERFORM wallet.wallet_transfer_atomic('CREATE_'||replace(gen_random_uuid()::text,'-',''),v_tx_type,p_initial_tokens,v_source,v_target,jsonb_build_object('actorId',p_actor_id,'createdUserId',v_user.id));
  END IF;
  INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details)
  VALUES(p_actor_id,'USER_CREATED','USER',v_user.id,jsonb_build_object('role',p_role,'initialTokens',p_initial_tokens::text));
  RETURN jsonb_build_object('user',jsonb_build_object('id',v_user.id,'username',v_user.username,'email',v_user.email,'role',p_role,'parentId',v_user.parent_id,'referredBy',v_user.referred_by_user_id,'referralCode',v_referral),'wallet',jsonb_build_object('id',v_target,'userId',v_user.id,'walletType',v_wallet_type,'balance',p_initial_tokens::text,'reservedBalance','0'));
END;
$function$;

CREATE OR REPLACE FUNCTION platform.register_referral_atomic(
  p_username text, p_email text, p_password_hash text, p_referral_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_ref record; v_user record; v_wallet uuid; v_code text;
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) NOT BETWEEN 3 AND 64 OR
     p_email IS NULL OR position('@' in p_email)=0 OR length(p_email)>254 OR
     p_password_hash IS NULL OR length(p_password_hash)<20 OR
     p_referral_code IS NULL OR length(trim(p_referral_code)) NOT BETWEEN 3 AND 64 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  SELECT r.owner_user_id,r.admin_id INTO v_ref
  FROM platform.referral_codes r
  JOIN platform.users owner ON owner.id=r.owner_user_id AND owner.is_active=true
  JOIN platform.role_assignments orole ON orole.user_id=owner.id AND orole.role='PLAYER'
  JOIN platform.users admin ON admin.id=r.admin_id AND admin.is_active=true
  JOIN platform.role_assignments arole ON arole.user_id=admin.id AND arole.role='ADMIN'
  WHERE r.code=trim(p_referral_code) AND r.is_active=true AND owner.parent_id=r.admin_id
  FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_REFERRAL_CODE' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM platform.users WHERE lower(username)=lower(trim(p_username)) OR lower(email)=lower(trim(p_email))) THEN
    RAISE EXCEPTION 'DUPLICATE_ACCOUNT' USING ERRCODE='23505';
  END IF;
  INSERT INTO platform.users(username,email,password_hash,parent_id,referred_by_user_id)
  VALUES(trim(p_username),lower(trim(p_email)),p_password_hash,v_ref.admin_id,v_ref.owner_user_id)
  RETURNING id,username,email,parent_id,referred_by_user_id INTO v_user;
  INSERT INTO platform.role_assignments(user_id,role,assigned_by) VALUES(v_user.id,'PLAYER',v_ref.admin_id);
  INSERT INTO wallet.wallets(user_id,wallet_type,balance) VALUES(v_user.id,'PLAYER',0) RETURNING id INTO v_wallet;
  INSERT INTO platform.user_profiles(user_id,display_name) VALUES(v_user.id,v_user.username);
  v_code := 'BD'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  INSERT INTO platform.referral_codes(code,owner_user_id,admin_id,is_active) VALUES(v_code,v_user.id,v_ref.admin_id,true);
  UPDATE platform.referral_codes SET usage_count=usage_count+1 WHERE code=trim(p_referral_code);
  INSERT INTO platform.audit_logs(actor_id,action,target_type,target_id,details)
  VALUES(v_user.id,'REFERRAL_REGISTRATION','USER',v_user.id,jsonb_build_object('referralCode',p_referral_code));
  RETURN jsonb_build_object('user',jsonb_build_object('id',v_user.id,'username',v_user.username,'email',v_user.email,'role','PLAYER','parentId',v_user.parent_id,'referredBy',v_user.referred_by_user_id,'referralCode',v_code),
    'wallet',jsonb_build_object('id',v_wallet,'userId',v_user.id,'walletType','PLAYER','balance','0','reservedBalance','0'));
END;
$function$;

REVOKE ALL ON FUNCTION platform.create_user_atomic(uuid,text,text,text,public.user_role_enum,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.register_referral_atomic(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.create_user_atomic(uuid,text,text,text,public.user_role_enum,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION platform.register_referral_atomic(text,text,text,text) TO service_role;
