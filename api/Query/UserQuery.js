'use strict'
let User = require('./../db').User
let Epic = require('./../db').Epic
let Query = require('./index')

/**
 * A class representing a rat query
 */
class UserQuery extends Query {
  /**
   * Create a sequelize user query from a set of parameters
   * @constructor
   * @param params
   * @param connection
   */
  constructor (params, connection) {
    super(params, connection)

    this._query.attributes = {
      exclude: [
        'deletedAt',
        'password'
      ]
    }
  }
}

module.exports = UserQuery