const { Engine } = require("json-rules-engine");
const { createEngine } = require("./index");
const { rules } = require("./rules");

async function verifyRules(ctx, next) {
  await rules.forEach(async (rule) => {
    let engine = createEngine(rule.type, rule.conditions, ctx, next);

    try {
      await engine.run(ctx.request.body);
    } catch (error) {
      ctx.status = 400;
      ctx.body = {
        message: `Missing one of required fields: ${rule.conditions.map(
          (cd) => cd.fact
        )}`,
      };
      return ctx;
    }
  });

  return next();
}

module.exports = { verifyRules };
