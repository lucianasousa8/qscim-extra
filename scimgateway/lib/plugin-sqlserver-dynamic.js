// =================================================================================
// File:    plugin-sqlserver.js
//
// Author:  Qriar Labs
//
// Purpose: dynamic SQL user-provisioning
//
// =================================================================================
"use strict";

const Connection = require("tedious").Connection;
const Request = require("tedious").Request;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// mandatory plugin initialization - start
const path = require("path");
let ScimGateway = require("./scimgateway");
const { JSONStringify } = require("./utils");
const scimgateway = new ScimGateway();
const pluginName = path.basename(__filename, ".js");
const configDir = path.join(__dirname, "..", "config");
const configFile = path.join(`${configDir}`, `${pluginName}.json`);
let config = require(configFile).endpoint;
config = scimgateway.processExtConfig(pluginName, config); // add any external config process.env and process.file
scimgateway.authPassThroughAllowed = false; // true enables auth passThrough (no scimgateway authentication). scimgateway instead includes ctx (ctx.request.header) in plugin methods. Note, requires plugin-logic for handling/passing ctx.request.header.authorization to be used in endpoint communication
// mandatory plugin initialization - end

if (config?.connection?.authentication?.options?.password) {
  const sqlPassword = scimgateway.getPassword(
    "endpoint.connection.authentication.options.password",
    configFile
  );
  config.connection.authentication.options.password = sqlPassword;
}

// =================================================
// getUsers
// =================================================
scimgateway.getUsers = async (baseEntity, getObj, attributes, ctx) => {
  //
  // "getObj" = { attribute: <>, operator: <>, value: <>, rawFilter: <>, startIndex: <>, count: <> }
  // rawFilter is always included when filtering
  // attribute, operator and value are included when requesting unique object or simpel filtering
  // See comments in the "mandatory if-else logic - start"
  //
  // "attributes" is array of attributes to be returned - if empty, all supported attributes should be returned
  // Should normally return all supported user attributes having id and userName as mandatory
  // id and userName are most often considered as "the same" having value = <UserID>
  // Note, the value of returned 'id' will be used as 'id' in modifyUser and deleteUser
  // scimgateway will automatically filter response according to the attributes list
  //
  const action = "getUsers";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" getObj=${
      getObj ? JSON.stringify(getObj) : ""
    } attributes=${attributes}`
  );

  let filter;

  // mandatory if-else logic - start
  if (getObj.operator) {
    if (
      getObj.operator === "eq" &&
      ["id", "userName", "externalId"].includes(getObj.attribute)
    ) {
      // mandatory - unique filtering - single unique user to be returned - correspond to getUser() in versions < 4.x.x

      filter = {
        ...(await scimgateway
          .endpointMapper("outbound", { id: getObj.value }, config.map.user)
          .then((res) => res[0])),
      };
    } else if (getObj.operator === "eq" && getObj.attribute === "group.value") {
      // optional - only used when groups are member of users, not default behavior - correspond to getGroupUsers() in versions < 4.x.x
      throw new Error(
        `${action} error: not supporting groups member of user filtering: ${getObj.rawFilter}`
      );
    } else {
      // optional - simpel filtering
      throw new Error(
        `${action} error: not supporting simpel filtering: ${getObj.rawFilter}`
      );
    }
  } else if (getObj.rawFilter) {
    // optional - advanced filtering having and/or/not - use getObj.rawFilter
    throw new Error(
      `${action} not error: supporting advanced filtering: ${getObj.rawFilter}`
    );
  } else {
    // mandatory - no filtering (!getObj.operator && !getObj.rawFilter) - all users to be returned - correspond to exploreUsers() in versions < 4.x.x
    filter = {};
  }
  // mandatory if-else logic - end

  if (!filter)
    throw new Error(
      `${action} error: mandatory if-else logic not fully implemented`
    );

  try {
    return await new Promise((resolve, reject) => {
      const ret = {
        // itemsPerPage will be set by scimgateway
        Resources: [],
        totalResults: null,
      };

      async function main() {
        const getAllScript = replaceValues(config.scripts.users.getAll, {
          filter: convertObjectToString(filter),
          id: getObj.value,
        });

        const getByIDScript = replaceValues(config.scripts.users.getByID, {
          filter: convertObjectToString(filter),
          id: getObj.value,
        });

        const rows = Object.keys(filter).length
          ? await prisma.$queryRawUnsafe(getByIDScript)
          : await prisma.$queryRawUnsafe(getAllScript);

        for (const row in rows) {
          const scimUser = await scimgateway
            .endpointMapper("inbound", rows[row], config.map.user)
            .then((res) => res[0]);
          ret.Resources.push(scimUser);
        }
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(ret); // all explored users
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers MSSQL client connect error: ${err.message}`
          );
          await prisma.$disconnect();
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// createUser
// =================================================
scimgateway.createUser = async (baseEntity, userObj, ctx) => {
  const action = "createUser";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" userObj=${JSON.stringify(
      userObj
    )}`
  );

  try {
    return await new Promise((resolve, reject) => {
      async function main() {
        const body = await scimgateway
          .endpointMapper("outbound", userObj, config.map.user)
          .then((res) => res[0]);

        const script = replaceValues(config.scripts.users.post, {
          columns: `(${Object.keys(body).join(", ")})`,
          values: `(${Object.values(body)
            .map((item) => formatValue(item))
            .join(", ")})`,
        });

        await prisma.$queryRawUnsafe(script);
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers MSSQL client connect error: ${err.message}`
          );
          await prisma.$disconnect();
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// deleteUser
// =================================================
scimgateway.deleteUser = async (baseEntity, id, ctx) => {
  const action = "deleteUser";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id}`
  );

  try {
    return await new Promise((resolve, reject) => {
      async function main() {
        let formattedId = await scimgateway
          .endpointMapper("outbound", { id }, config.map.user)
          .then((res) => res[0]);

        const script = replaceValues(config.scripts.users.delete, {
          filter: convertObjectToString(formattedId),
          id: id,
        });

        await prisma.$queryRawUnsafe(script);
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `deleteUser MSSQL client connect error: ${err.message}`
          );
          await prisma.$disconnect();
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// modifyUser
// =================================================
scimgateway.modifyUser = async (baseEntity, id, attrObj, ctx) => {
  const action = "modifyUser";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id} attrObj=${JSON.stringify(
      attrObj
    )}`
  );

  try {
    return await new Promise((resolve, reject) => {
      async function main() {
        const body = await scimgateway
          .endpointMapper("outbound", attrObj, config.map.user)
          .then((res) => res[0]);

        let formattedId = await scimgateway
          .endpointMapper("outbound", { id }, config.map.user)
          .then((res) => res[0]);

        const script = replaceValues(config.scripts.users.put, {
          filter: convertObjectToString(formattedId),
          id: id,
          body: convertObjectToString(body),
          columns: `(${Object.keys(body).join(", ")})`,
          values: `(${Object.values(body)
            .map((item) => formatValue(item))
            .join(", ")})`,
        });

        await prisma.$queryRawUnsafe(script);
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `modifyUser MSSQL client connect error: ${err.message}`
          );
          await prisma.$disconnect();
          return reject(e);
        });
    }); // Promise
  } catch (err) {
    throw new Error(`${action} error: ${err.message}`);
  }
};

// =================================================
// getGroups
// =================================================
scimgateway.getGroups = async (baseEntity, getObj, attributes, ctx) => {
  //
  // "getObj" = { attribute: <>, operator: <>, value: <>, rawFilter: <>, startIndex: <>, count: <> }
  // rawFilter is always included when filtering
  // attribute, operator and value are included when requesting unique object or simpel filtering
  // See comments in the "mandatory if-else logic - start"
  //
  // "attributes" is array of attributes to be returned - if empty, all supported attributes should be returned
  // Should normally return all supported group attributes having id, displayName and members as mandatory
  // id and displayName are most often considered as "the same" having value = <GroupName>
  // Note, the value of returned 'id' will be used as 'id' in modifyGroup and deleteGroup
  // scimgateway will automatically filter response according to the attributes list
  //
  const action = "getGroups";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" getObj=${
      getObj ? JSON.stringify(getObj) : ""
    } attributes=${attributes}`
  );

  // mandatory if-else logic - start
  if (getObj.operator) {
    if (
      getObj.operator === "eq" &&
      ["id", "displayName", "externalId"].includes(getObj.attribute)
    ) {
      // mandatory - unique filtering - single unique user to be returned - correspond to getUser() in versions < 4.x.x
    } else if (
      getObj.operator === "eq" &&
      getObj.attribute === "members.value"
    ) {
      // mandatory - return all groups the user 'id' (getObj.value) is member of - correspond to getGroupMembers() in versions < 4.x.x
      // Resources = [{ id: <id-group>> , displayName: <displayName-group>, members [{value: <id-user>}] }]
    } else {
      // optional - simpel filtering
    }
  } else if (getObj.rawFilter) {
    // optional - advanced filtering having and/or/not - use getObj.rawFilter
  } else {
    // mandatory - no filtering (!getObj.operator && !getObj.rawFilter) - all groups to be returned - correspond to exploreGroups() in versions < 4.x.x
  }
  // mandatory if-else logic - end

  return { Resources: [] }; // groups not supported - returning empty Resources
};

// =================================================
// createGroup
// =================================================
scimgateway.createGroup = async (baseEntity, groupObj, ctx) => {
  const action = "createGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" groupObj=${JSON.stringify(
      groupObj
    )}`
  );
  throw new Error(`${action} error: ${action} is not supported`);
};

// =================================================
// deleteGroup
// =================================================
scimgateway.deleteGroup = async (baseEntity, id, ctx) => {
  const action = "deleteGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id}`
  );
  throw new Error(`${action} error: ${action} is not supported`);
};

// =================================================
// modifyGroup
// =================================================
scimgateway.modifyGroup = async (baseEntity, id, attrObj, ctx) => {
  const action = "modifyGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id} attrObj=${JSON.stringify(
      attrObj
    )}`
  );
  throw new Error(`${action} error: ${action} is not supported`);
};

// =================================================
// helpers
// =================================================

function replaceValues(script, values) {
  let newScript = script;

  function checkAndReplace(field) {
    if (values[field]) {
      newScript = newScript.replace(`{{${field}}}`, values[field]);
    }
  }

  let names = ["filter", "id", "columns", "values", "body"];
  names.forEach((name) => {
    checkAndReplace(name);
  });

  return newScript;
}

function convertObjectToString(object) {
  let stringList = [];
  for (const [key, value] of Object.entries(object)) {
    stringList.push(`${key}=${formatValue(value)}`);
  }
  return stringList.join(", ");
}

function formatValue(value) {
  if (typeof value === "string") {
    return `'${value}'`;
  }
  return value;
}

//
// Cleanup on exit
//
process.on("SIGTERM", () => {
  // kill
});
process.on("SIGINT", () => {
  // Ctrl+C
});
