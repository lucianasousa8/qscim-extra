const { createEngine } = require("./index");
const { rules } = require("./rules");

async function verifyRules(ctx, next) {
  const results = await Promise.all(
    rules.map(async (rule) => {
      let engine = createEngine(rule.type, rule.conditions, ctx, next);

      if (ctx.request.header.host.split(":")[1] !== rule.port) {
        return true;
      }
      try {
        await engine.run(ctx.request.body);
        return true;
      } catch (error) {
        let errors = ctx.body?.rules || [];
        if (error.message !== "verification failed") {
          errors.push(
            `Missing one of required fields: ${rule.conditions.map(
              (cd) => cd.fact
            )}`
          );
        }

        ctx.status = 400;
        ctx.body = {
          message: "Error while verifying rules",
          rules: errors,
        };
        return ctx;
      }
    })
  );

  return results.every((item) => item === true)
}

module.exports = { verifyRules };

