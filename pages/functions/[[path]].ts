import app from '../../worker/src/index.ts';

/** Pages has no `ratelimits` binding, so `RL_AUTH` / `RL_API` stay absent and `rate.ts` falls back. */
interface PagesEnv {
  DB: D1Database;
  ADMIN_TOKEN?: string;
}

/**
 * Pages Functions entry: `_routes.json` limits this to `/v1/*` and `/health`, so
 * static assets never reach here and the workbench keeps calling `/v1/*` same-origin.
 */
export const onRequest: PagesFunction<PagesEnv> = (context) =>
  app.fetch(context.request, context.env, context as unknown as ExecutionContext);