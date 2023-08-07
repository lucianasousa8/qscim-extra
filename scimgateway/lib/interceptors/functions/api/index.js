const { requests } = require("../../data/requests");
const { formatAuth } = require("../../utils/formatAuth");
const { formatURL } = require("../../utils/formatURL");

async function fetchApi(ctx, next, caches) {
  const results = await Promise.all(
    requests.map(async (request) => {
      if (ctx.request.header.host.split(":")[1] !== request.port) {
        return true;
      }

      try {
        let cachedData;
        if (request.auth.cached) {
          cachedData = await caches[request.auth.cached].getData();
        }

        let formattedURL = formatURL(ctx.request.body, request.url);
        const response = await fetch(formattedURL, {
          method: request.method,
          headers: {
            Authorization: formatAuth({ ...request.auth, ...cachedData }),
          },
        });
        const jsonData = await response.json();

        let responseAttrs = {};
        request.mapping.forEach((item) => {
          responseAttrs[item.mapTo] = jsonData[item.name];
        });

        ctx.request.body = { ...ctx.request.body, ...responseAttrs };
        return true;
      } catch (error) {
        ctx.status = 400;
        ctx.body = {
          message: "Error while fetching interceptor api",
          url: request.url,
          error: error.message,
        };
        return ctx;
      }
    })
  );

  return results.every((item) => item === true);
}

module.exports = { fetchApi };
