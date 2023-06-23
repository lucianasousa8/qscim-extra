const { requests } = require("./requests");

async function fetchApi(ctx, next) {
  const results = await Promise.all(
    requests.map(async (request) => {
      if (ctx.request.header.host.split(":")[1] !== request.port) {
        return true;
      }

      try {
        const response = await fetch(request.url, { method: request.method });
        const jsonData = await response.json();
        ctx.request.body = { ...ctx.request.body, ...jsonData };
        return true;
      } catch (error) {
        ctx.status = 400;
        ctx.body = {
          message: "Error while fetching interceptor api",
          url: request.url,
          error: error.message
        };
        return ctx;
      }
    })
  );

  return results.every((item) => item === true);
}

module.exports = { fetchApi };

