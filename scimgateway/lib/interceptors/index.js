const { Engine } = require("json-rules-engine");

function createEngine(type, conditions, ctx, next) {
  let engine = new Engine();

  let conditionsString = conditions.map((cd) => {
    return `${cd.fact} ${cd.operator} ${cd.value}`;
  });

  engine.addRule({
    conditions: {
      [type]: conditions,
    },
    onSuccess() {
      return;
    },
    onFailure() {
      ctx.status = 400;
      ctx.body = {
        message: "error while verifying rules",
        rules: conditionsString,
      };
      return ctx;
    },
    event: {
      type: "message",
    },
  });

  return engine;
}

module.exports = { createEngine };

