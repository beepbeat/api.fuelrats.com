/*
 Copyright (c) 2017, The Fuel Rats Mischief
 All rights reserved.
 
 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions
 are met:
 
 1. Redistributions of source code must retain the above copyright
 notice, this list of conditions and the following disclaimer.
 
 2. Redistributions in binary form must reproduce the above copyright
 notice, this list of conditions and the following disclaimer in the
 documentation and/or other materials provided with the distribution.
 
 3. Neither the name of the copyright holder nor the names of its
 contributors may be used to endorse or promote products derived from
 this software without specific prior written permission.
 
 THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import Kitura
import HeliumLogger
import SwiftKuery
import SwiftKueryPostgreSQL

print("API Starting")

let users = Users()
let rats = Rats()

print("Making Connection")
let connection = PostgreSQLConnection(host: "127.0.0.1", port: 5432, options: [
    .databaseName("fuelrats"),
    .userName("fuelrats")
])

connection.connect() { error in
    if let error = error {
        print(error)
        return
    }
    
    print("Connected")
    let userQuery = Select(from: [users])
    connection.execute(query: userQuery) { result in
        if let results = result.asResultSet.toResultType(model: User.self) {
            print(results)
        } else if let queryError = result.asError {
            print(queryError)
        }
    
    }
    
    let ratQuery = Select(from: [rats]).where(rats.name == "xlexious")
    connection.execute(query: ratQuery) { result in
        if let results = result.asResultSet.toResultType(model: Rat.self) {
            print(results)
        } else if let queryError = result.asError {
            print(queryError)
        }
        
    }
}





let router = Router()

router.get("/") {
    request, response, next in
    response.send("Hello, World, this is a swift web server bitch")
    next()
}

Kitura.addHTTPServer(onPort: 8090, with: router)
Kitura.run()