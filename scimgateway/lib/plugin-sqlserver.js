// =================================================================================
// File:    plugin-sqlserver.js
//
// Author:  Samuel Vianna
//
// Purpose: SQL user-provisioning
//
// =================================================================================
"use strict";

const Connection = require("tedious").Connection;
const Request = require("tedious").Request;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// mandatory plugin initialization - start
const path = require("path");
let ScimGateway = null;
try {
  ScimGateway = require("scimgateway");
} catch (err) {
  ScimGateway = require("./scimgateway");
}
const scimgateway = new ScimGateway();
const pluginName = path.basename(__filename, ".js");
const configDir = path.join(__dirname, "..", "config");
const configFile = path.join(`${configDir}`, `${pluginName}.json`);
const validScimAttr = [
  // array containing scim attributes supported by our plugin code. Empty array - all attrbutes are supported by endpoint
  "userName", // userName is mandatory
  "active", // active is mandatory
  "password",
  "name.givenName",
  "name.middleName",
  "name.familyName",
  "id", // "emails",         // accepts all multivalues for this key
  "emails.work", // accepts multivalues if type value equal work (lowercase)
  // "phoneNumbers",
  "phoneNumbers.work",
];
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
        ...scimgateway.endpointMapper(
          "outbound",
          { id: getObj.value },
          config.map.user
        )[0],
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
        const rows = await prisma.user.findMany({ where: filter });

        for (const row in rows) {
          const scimUser = scimgateway.endpointMapper(
            "inbound",
            rows[row],
            config.map.user
          )[0];
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
      const notValid = scimgateway.notValidAttributes(userObj, validScimAttr);
      if (notValid) {
        const err = Error(
          `unsupported scim attributes: ${notValid} (supporting only these attributes: ${validScimAttr.toString()})`
        );
        return reject(err);
      }

      async function main() {
        const newUser = scimgateway.endpointMapper(
          "outbound",
          userObj,
          config.map.user
        )[0];

        await prisma.user.create({ data: newUser });
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
        await prisma.user.delete({
          where: scimgateway.endpointMapper(
            "outbound",
            { id },
            config.map.user
          )[0],
        });
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
      const notValid = scimgateway.notValidAttributes(attrObj, validScimAttr);
      if (notValid) {
        const err = Error(
          `unsupported scim attributes: ${notValid} (supporting only these attributes: ${validScimAttr.toString()})`
        );
        return reject(err);
      }

      async function main() {
        const updatedUser = scimgateway.endpointMapper(
          "outbound",
          attrObj,
          config.map.user
        )[0];

        await prisma.user.update({
          where: scimgateway.endpointMapper(
            "outbound",
            { id },
            config.map.user
          )[0],
          data: updatedUser,
        });
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

//
// Cleanup on exit
//
process.on("SIGTERM", () => {
  // kill
});
process.on("SIGINT", () => {
  // Ctrl+C
});

