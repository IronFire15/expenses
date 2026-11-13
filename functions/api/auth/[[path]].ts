import { handleAuth, type Env } from '../../../server/auth'

/** Cloudflare Pages Function for every /api/auth/* address. The logic lives in server/auth.ts. */
export const onRequest = (context: { request: Request; env: Env }) => handleAuth(context.request, context.env)
