import { validator } from 'hono/validator';
import type { z } from 'zod';

/**
 * Check a part of the request against a zod schema.
 * A bad request gets 400 with the first problem as the error text.
 * The schema also tells the typed web client (hono/client) what the route accepts.
 */
function checked<Target extends 'json' | 'form' | 'query' | 'param', Schema extends z.ZodType>(target: Target, schema: Schema) {
  return validator(target, (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
    return result.data as z.output<Schema>;
  });
}

export const checkedJson = <Schema extends z.ZodType>(schema: Schema) => checked('json', schema);
export const checkedForm = <Schema extends z.ZodType>(schema: Schema) => checked('form', schema);
export const checkedQuery = <Schema extends z.ZodType>(schema: Schema) => checked('query', schema);
export const checkedParam = <Schema extends z.ZodType>(schema: Schema) => checked('param', schema);
