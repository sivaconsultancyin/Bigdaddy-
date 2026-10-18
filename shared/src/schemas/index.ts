import { z } from 'zod';
import { UserRole } from '../types';

export const loginSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6),
});

export const createUserSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Alphanumeric and underscores only'),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.nativeEnum(UserRole),
  initialTokens: z.string().regex(/^\d+$/).optional().default('0'),
});

export const referralRegisterSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Alphanumeric and underscores only'),
  email: z.string().email(),
  password: z.string().min(6),
  referralCode: z.string().min(4).max(20),
});

export const tokenRequestSchema = z.object({
  amount: z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer'),
  note: z.string().max(200).optional(),
});

export const approveTokenRequestSchema = z.object({
  decisionNote: z.string().max(200).optional(),
});

export const rejectTokenRequestSchema = z.object({
  decisionNote: z.string().max(200).optional(),
});

export const allocatePoolSchema = z.object({
  gameId: z.string(),
  amount: z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer'),
});

export const directTransferSchema = z.object({
  recipientId: z.string(),
  amount: z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer'),
  note: z.string().max(200).optional(),
});

export const aviatorBetSchema = z.object({
  amount: z.string().regex(/^[1-9]\d*$/, 'Bet amount must be a positive integer'),
  autoCashoutMultiplier: z.number().min(1.01).max(1000).nullable().optional(),
});

export const aviatorCashoutSchema = z.object({
  betId: z.string(),
});

export const rouletteBetItemSchema = z.object({
  id: z.string().optional(),
  type: z.enum([
    'straight',
    'split',
    'street',
    'corner',
    'line',
    'red',
    'black',
    'even',
    'odd',
    'low',
    'high',
    'dozen1',
    'dozen2',
    'dozen3',
    'col1',
    'col2',
    'col3',
  ]),
  numbers: z.array(z.number().int().min(0).max(36)),
  amount: z.string().regex(/^[1-9]\d*$/, 'Bet amount must be a positive integer'),
});

export const rouletteSpinSchema = z.object({
  bets: z.array(rouletteBetItemSchema).min(1, 'At least one bet must be placed'),
});

export const roulettePlaceBetSchema = rouletteSpinSchema;
