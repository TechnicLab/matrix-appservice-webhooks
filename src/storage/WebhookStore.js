var DBMigrate = require("db-migrate");
var LogService = require("./../LogService");
var Sequelize = require('sequelize');
var dbConfig = require("../../config/database.json");
var _ = require("lodash");
var randomString = require('random-string');

/**
 * Primary storage for the Webhook Bridge
 */
class WebhookStore {

    /**
     * Creates a new Instagram store. Call `prepare` before use.
     */
    constructor() {
        this._orm = null;
    }

    /**
     * Prepares the store for use
     */
    prepare() {
        var env = process.env.NODE_ENV || "development";
        LogService.info("WebhookStore", "Running migrations");
        return new Promise((resolve, reject)=> {
            var dbMigrate = DBMigrate.getInstance(true, {
                config: "./config/database.json",
                env: env
            });
            dbMigrate.internals.argv.count = undefined; // HACK: Fix db-migrate from using `config/config.yaml` as the count. See https://github.com/turt2live/matrix-appservice-instagram/issues/11
            dbMigrate.up().then(() => {
                var dbConfigEnv = dbConfig[env];
                if (!dbConfigEnv) throw new Error("Could not find DB config for " + env);

                var opts = {
                    host: dbConfigEnv.host || 'localhost',
                    dialect: 'sqlite',
                    storage: dbConfigEnv.filename,
                    pool: {
                        max: 5,
                        min: 0,
                        idle: 10000
                    },
                    logging: i => LogService.verbose("WebhookStore [SQL]", i)
                };

                this._orm = new Sequelize(dbConfigEnv.database || 'webhooks', dbConfigEnv.username, dbConfigEnv.password, opts);
                this._bindModels();
                resolve();
            }, err => {
                LogService.error("WebhookStore", err);
                reject(err);
            }).catch(err => {
                LogService.error("WebhookStore", err);
                reject(err);
            });
        });
    }

    /**
     * Binds all of the models to the ORM.
     * @private
     */
    _bindModels() {
        // Models
        this.__AccountData = this._orm.import(__dirname + "/models/account_data");
        this.__Webhooks = this._orm.import(__dirname + "/models/webhooks");
    }

    /**
     * Gets the account data for the given object
     * @param {string} objectId the object that has account data to look for
     * @returns {Promise<*>} resolves to a json object representing the key/value pairs
     */
    getAccountData(objectId) {
        return this.__AccountData.findAll({where: {objectId: objectId}}).then(rows => {
            var container = {};
            for (var row of rows) {
                container[row.key] = row.value;
            }
            return container;
        });
    }

    /**
     * Saves the object's account data. Takes the value verbatim, expecting a string.
     * @param {string} objectId the object this account data belongs to
     * @param {*} data the data to save
     * @returns {Promise<>} resolves when complete
     */
    setAccountData(objectId, data) {
        return this.__AccountData.destroy({where: {objectId: objectId}, truncate: true}).then(() => {
            var promises = [];

            var keys = _.keys(data);
            for (var key of keys) {
                promises.push(this.__AccountData.create({objectId: objectId, key: key, value: data[key]}));
            }

            return Promise.all(promises);
        });
    }

    /**
     * Creates a new webhook
     * @param {string} roomId the matrix room ID the webhook is for
     * @param {string} userId the matrix user who created the webhook
     * @returns {Promise<Webhook>} resolves to the created webhook
     */
    createWebhook(roomId, userId) {
        return this.__Webhooks.create({
            id: randomString({length: 64}),
            roomId: roomId,
            userId: userId
        });
    }

    /**
     * Lists all of the webhooks for a given room
     * @param {string} roomId the room ID to search in
     * @returns {Promise<Webhook[]>} resolves to a list of webhooks, may be empty
     */
    listWebhooks(roomId) {
        return this.__Webhooks.findAll({where: {roomId: roomId}}).then(hooks => _.map(hooks, h => new Webhook(h)));
    }

    /**
     * Deletes a webhook from the store
     * @param {string} roomId the room ID
     * @param {string} hookId the hook's ID
     * @returns {Promise<*>} resolves when the hook has been deleted
     */
    deleteWebhook(roomId, hookId) {
        return this.__Webhooks.destroy({where: {roomId: roomId, id: hookId}});
    }

    /**
     * Gets a webhook from the database by ID
     * @param {string} hookId the hook ID to lookup
     * @returns {Promise<Webhook>} resolves to the webhook, or null if not found
     */
    getWebhook(hookId) {
        return this.__Webhooks.findById(hookId).then(hook => hook ? new Webhook(hook) : null);
    }
}

class Webhook {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.roomId = dbFields.roomId;
        this.userId = dbFields.userId;
    }
}

module.exports = new WebhookStore();