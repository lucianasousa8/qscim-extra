const { createEngine } = require("./index");
const { rules } = require("./rules");

function verifyRules(ctx, next) {
  rules.forEach(async (rule) => {
    let engine = createEngine(rule.type, rule.conditions, ctx, next);

    if (ctx.request.header.host.split(":")[1] !== rule.port) {
      return true;
    }
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

