// =================================================================================
// File:    plugin-sqlserver.js
//
// Author:  Qriar Labs
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
let ScimGateway = require("./scimgateway");
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

const userSchema = prisma[config.connection.options.userTableName];
const groupSchema = prisma[config.connection.options.groupTableName];
const relationSchema = prisma[config.connection.options.relationTableName];

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
          .endpointMapper(
            "outbound",
            { userName: getObj.value },
            config.map.user
          )
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
        const rows = await userSchema.findMany({ where: filter });

        for (const row in rows) {
          const scimUser = await scimgateway
            .endpointMapper("inbound", rows[row], config.map.user)
            .then((res) => res[0]);

          const userId = await scimgateway
            .endpointMapper("outbound", { id: scimUser.id }, config.map.user)
            .then((res) => res[0]);

          const relationId = await scimgateway
            .endpointMapper("outbound", userId, config.map.relation)
            .then((res) => res[0]);

          const groups = await groupSchema.findMany({
            where: { users: { some: relationId } },
          });

          const groupsList = await groups.map(async (group) => {
            const formattedGroup = await scimgateway
              .endpointMapper("inbound", group, config.map.group)
              .then((res) => res[0]);

            return {
              value: formattedGroup.id,
              display: formattedGroup.displayName,
            };
          });

          scimUser.id = scimUser.userName;
          ret.Resources.push({ ...scimUser, groups: groupsList });
        }
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(ret); // all explored users
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreUsers SQL Server client connect error: ${err.message}`
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
        const newUser = await scimgateway
          .endpointMapper("outbound", userObj, config.map.user)
          .then((res) => res[0]);

        const activeBody = await scimgateway
          .endpointMapper("outbound", { active: true }, config.map.user)
          .then((res) => res[0]);

        await userSchema
          .update({
            where: await scimgateway
              .endpointMapper(
                "outbound",
                { userName: userObj.userName },
                config.map.user
              )
              .then((res) => res[0]),
            data: { ...newUser, ...activeBody },
          })
          .then((res) => {
            console.log("user already exists, updating");
          })
          .catch(async (err) => {
            console.log("creating new user");
            await userSchema.create({ data: newUser });
          });
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `createUser SQL Server client connect error: ${err.message}`
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
        await userSchema.delete({
          where: await scimgateway
            .endpointMapper("outbound", { userName: id }, config.map.user)
            .then((res) => res[0]),
        });
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `deleteUser SQL Server client connect error: ${err.message}`
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
        console.log("user updated");
        const updatedUser = await scimgateway
          .endpointMapper("outbound", attrObj, config.map.user)
          .then((res) => res[0]);

        await userSchema.update({
          where: await scimgateway
            .endpointMapper("outbound", { userName: id }, config.map.user)
            .then((res) => res[0]),
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
            `modifyUser SQL Server client connect error: ${err.message}`
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

  let filter;
  // mandatory if-else logic - start
  if (getObj.operator) {
    if (
      getObj.operator === "eq" &&
      ["id", "displayName", "externalId"].includes(getObj.attribute)
    ) {
      // mandatory - unique filtering - single unique user to be returned - correspond to getUser() in versions < 4.x.x
      filter = {
        ...(await scimgateway
          .endpointMapper("outbound", { id: getObj.value }, config.map.group)
          .then((res) => res[0])),
      };
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

  try {
    return await new Promise((resolve, reject) => {
      const ret = {
        // itemsPerPage will be set by scimgateway
        Resources: [],
        totalResults: null,
      };

      async function main() {
        const rows = await groupSchema.findMany({ where: filter });

        for (const row in rows) {
          const scimGroup = await scimgateway
            .endpointMapper("inbound", rows[row], config.map.group)
            .then((res) => res[0]);

          const groupId = await scimgateway
            .endpointMapper("outbound", { id: scimGroup.id }, config.map.group)
            .then((res) => res[0]);

          const relationId = await scimgateway
            .endpointMapper("outbound", groupId, config.map.relation)
            .then((res) => res[0]);

          const users = await userSchema.findMany({
            where: { groups: { some: relationId } },
          });

          const members = await users.map(async (user) => {
            const formattedUser = await scimgateway
              .endpointMapper("inbound", user, config.map.user)
              .then((res) => res[0]);

            return {
              value: formattedUser.id,
              display: formattedUser.userName,
            };
          });

          ret.Resources.push({ ...scimGroup, members });
        }
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(ret); // all explored users
        })
        .catch(async (err) => {
          const e = new Error(
            `exploreGroups SQL Server client connect error: ${err.message}`
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
// createGroup
// =================================================
scimgateway.createGroup = async (baseEntity, groupObj, ctx) => {
  const action = "createGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" groupObj=${JSON.stringify(
      groupObj
    )}`
  );

  try {
    return await new Promise((resolve, reject) => {
      async function main() {
        const newGroup = await scimgateway
          .endpointMapper("outbound", groupObj, config.map.group)
          .then((res) => res[0]);

        await groupSchema.create({ data: newGroup });
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `createGroup SQL Server client connect error: ${err.message}`
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
// deleteGroup
// =================================================
scimgateway.deleteGroup = async (baseEntity, id, ctx) => {
  const action = "deleteGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id}`
  );

  try {
    return await new Promise((resolve, reject) => {
      async function main() {
        await groupSchema.delete({
          where: await scimgateway
            .endpointMapper("outbound", { id }, config.map.group)
            .then((res) => res[0]),
        });
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `deleteGroup SQL Server client connect error: ${err.message}`
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
// modifyGroup
// =================================================
scimgateway.modifyGroup = async (baseEntity, id, attrObj, ctx) => {
  const action = "modifyGroup";
  scimgateway.logger.debug(
    `${pluginName}[${baseEntity}] handling "${action}" id=${id} attrObj=${JSON.stringify(
      attrObj
    )}`
  );

  try {
    return await new Promise((resolve, reject) => {
      async function main() {
        const updatedGroup = await scimgateway
          .endpointMapper("outbound", attrObj, config.map.group)
          .then((res) => res[0]);

        if (attrObj.members?.length) {
          for (const memberIndex in attrObj.members) {
            const member = attrObj.members[memberIndex];

            const userFilter = await scimgateway
              .endpointMapper(
                "outbound",
                { userName: member.value },
                config.map.user
              )
              .then((res) => res[0]);

            const user = await userSchema.findFirst({
              where: userFilter,
            });

            const groupId = await scimgateway
              .endpointMapper("outbound", { id: id }, config.map.group)
              .then((res) => res[0]);

            const relData = await scimgateway
              .endpointMapper(
                "outbound",
                { ...user, ...groupId },
                config.map.relation
              )
              .then((res) => res[0]);

            if (member.operation === "delete") {
              await relationSchema.deleteMany({
                where: relData,
              });
            } else {
              const rel = await relationSchema.findFirst({ where: relData });
              if (!rel) {
                await relationSchema.create({
                  data: relData,
                });
              } else {
                console.log("relation already exists");
              }
            }
          }
        }

        await groupSchema.update({
          where: await scimgateway
            .endpointMapper("outbound", { id }, config.map.group)
            .then((res) => res[0]),
          data: updatedGroup,
        });
      }

      main()
        .then(async () => {
          await prisma.$disconnect();
          resolve(null);
        })
        .catch(async (err) => {
          const e = new Error(
            `modifyGroup SQL Server client connect error: ${err.message}`
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
