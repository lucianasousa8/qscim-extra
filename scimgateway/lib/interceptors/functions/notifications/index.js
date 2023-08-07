const { notifications } = require("../../data/notifications");
const { formatAuth } = require("../../utils/formatAuth");
const { formatURL } = require("../../utils/formatURL");

function verifyAllowedRequests(allowedRequests, method, route) {
  const results = allowedRequests.map(
    (item) => item.method === method && item.route === route
  );

  return results.some((item) => item === true);
}

async function fetchNotification(ctx, type, caches) {
  const results = await Promise.all(
    notifications
      .filter(
        (request) =>
          request.port === ctx.request.header.host.split(":")[1] &&
          request.type === type &&
          verifyAllowedRequests(
            request.allowedRequests,
            ctx.request.method,
            ctx.request.url.split("/")[1]
          )
      )
      .map(async (request) => {
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
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              info: {
                url: ctx.request.url,
                method: ctx.request.method,
                type: request.type,
              },
              data:
                request.payload === "response" ? ctx.body : ctx.request.body,
            }),
          });

          if (![200, 201].includes(response.status)) {
            throw new Error(`Request returned status ${response.status}`);
          }

          return true;
        } catch (error) {
          ctx.status = 400;
          ctx.body = {
            message: "Error while fetching notification api",
            type: `Notification type: ${request.type}`,
            details:
              request.type === "before"
                ? "SCIM request not fetched yet"
                : "SCIM request already fetched",
            url: request.url,
            error: error.message,
          };
          return ctx;
        }
      })
  );

  return results.every((item) => item === true);
}

module.exports = { fetchNotification };
