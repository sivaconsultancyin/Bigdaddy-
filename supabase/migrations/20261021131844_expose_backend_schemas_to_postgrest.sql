ALTER ROLE authenticator SET pgrst.db_schemas = 'public,graphql_public,platform,wallet,aviator,roulette,dice,dragon_tiger,andar_bahar';
NOTIFY pgrst, 'reload config';