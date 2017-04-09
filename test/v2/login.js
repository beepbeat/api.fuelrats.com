'use strict'
let { GET, POST, Request } = require('../../api/classes/Request')


module.exports = {
  testLogin: function (test) {
    test.expect(11)

    let loginData = {
      email: 'admintestuser@fuelrats.com',
      password: 'testuser'
    }

    new Request(POST, {
      path: '/login',
      insecure: true
    }, loginData).then(function (post) {
      let res = post.body

      test.strictEqual(post.response.statusCode, 200)

      test.equal(res.error, null)
      test.notEqual(res.data.id, null)
      test.strictEqual(res.data.email, 'admintestuser@fuelrats.com')
      test.ok(res.data.groups.includes('rat'), 'User result does not contain rat user group')
      test.ok(res.data.groups.includes('dispatch'), 'User result does not contain dispatch user group')
      test.ok(res.data.groups.includes('admin'), 'User result does not contain admin user group')
      test.notStrictEqual(Date.parse(res.data.createdAt), NaN)
      test.notStrictEqual(Date.parse(res.data.updatedAt), NaN)
      test.ok(res.data.nicknames.includes('admintestnick'), 'User result does not contain test nickname')
      test.equal(res.data.image, null)

      test.done()
    })
  },

  testInvalidLogin: function (test) {
    test.expect(2)
    let loginData = {
      email: 'blackrats@fuelrats.com',
      password: 'testuser'
    }

    new Request(POST, {
      path: '/login',
      insecure: true
    }, loginData).then(function (post) {
      let res = post.body

      test.strictEqual(post.response.statusCode, 401)

      test.equal(res, 'Unauthorized')

      test.done()
    })
  },

  testSSOLogin: function (test) {
    test.expect(3)

    let loginData = {
      email: 'admintestuser@fuelrats.com',
      password: 'testuser',
      redirect: 'https://www.fuelrats.com/',
    }

    new Request(POST, {
      path: '/ssologin',
      insecure: true
    }, loginData).then(function (post) {
      let res = post.body

      test.strictEqual(post.response.statusCode, 302)
      test.strictEqual(post.response.headers.location, 'https://www.fuelrats.com/')
      test.equal(res, 'Found. Redirecting to https://www.fuelrats.com/')

      test.done()
    })
  },
}