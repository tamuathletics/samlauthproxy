var express = require("express");
var logger = require('morgan');
var bodyParser = require('body-parser');
var fs = require('fs');
var Utils = require('./utils');
var jwt = require("jsonwebtoken")
var app = express();

var passport = require('passport');
var saml = require('passport-saml');
const { decode } = require("punycode");

passport.serializeUser(function(user, done) {
    done(null, user);
});
  
passport.deserializeUser(function(user, done) {
    done(null, user);
});

async function getTenants() {
  if(process.env.tenant_secret) {
    console.log("Assuming to be running on GCP. Fetching tenant secret")
    // Import the Secret Manager client and instantiate it:
    const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
  
    const [version] = await client.accessSecretVersion({
      name: `${process.env.tenant_secret}/versions/latest`,
    });
    
    return Promise.resolve(JSON.parse(version.payload.data.toString()))
  } else {
    console.log("Running natively")
    let tenantRawData = fs.readFileSync(__dirname + '/tenants.json')
    return JSON.parse(tenantRawData)
  }
}

var tenants = {}

getTenants()
  .then( tenantData => {
    tenants = tenantData
    console.log(` Tenant data: ${tenantData}`)
    console.log(tenants.constructor.name)
    tenantData.forEach(tenant => {
      tenant['samlStrategy'] = new saml.Strategy({
        callbackUrl: tenant['callbackUrl'],
        entryPoint: tenant['entryPoint'],
        issuer: tenant['issuer'],
        identifierFormat: null,
        cert: tenant['idpCert'],
        validateInResponseTo: false,
        disableRequestedAuthnContext: true
      }, function(profile, done) {
        return done(null, profile); 
      })
    })
  })
  .catch(err => {
    console.log(`Error occured getting tenants: ${err}`)
  })



var findTenantByAppId = ( (id, tenants) => {
  console.log("looking for tenant id " + id)
  return tenants.find(t => {
    return t['appId'] == id
  })
})

app.use(passport.initialize());
app.use(passport.session());

//Middleware for logging requests
app.use(logger('dev'));

//parse application/json
app.use(bodyParser.json({limit: '50mb'}));

//parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({limit: '50mb', extended: false}));

app.get('/', (req, res) => {
    res.status(301).redirect('https://help.athletics.tamu.edu')
})

app.get('/login/:appid',
  function (req, res, next) {
    let appid = req.params.appid
    
    if (!tenants.length) {
      res.status(503).send('Tenant data unavailable')
      return
    }

    let tenant = findTenantByAppId(appid, tenants)
    if(tenant) {
      let returnUrl = req.query.returnUrl || tenant.returnUrl
      console.log(`return url is found to be: ${returnUrl}`)
      console.log(`Login request for tenant '${tenant.description}' (ID: ${appid})`)
      passport.use(tenant.samlStrategy)
      passport.authenticate('saml', 
        { 
          additionalParams: {'RelayState': encodeURI(returnUrl)},
          failureRedirect: '/login/fail'
        }
      )(req,res,next)
    } else {
      let msg = 'Tenant ID not found'
      console.log(`Login request for unknown tenant: ${appid}`)
      res.status(404).format({
        'plain': function () {
          res.send(msg)
        },
      
        'html': function () {
          fs.readFile('404.html', "utf8", (err, data) => {
            if(err) {
              console.log('404 file not found')
              res.send(msg)
            }
            res.send(data)
          })
        },
      
        'json': function () {
          res.send({error: msg})
        },
      
        default: function () {
          res.status(406).send('Not Acceptable')
        }
      })
    }
  }
);

app.post('/login/callback/:appid',
  (req, res, next) => {
    console.log("in saml callback for tenant " + req.params.appid)
    let tenant = findTenantByAppId(req.params.appid, tenants)
    if(tenant) {
      res.locals.tenant = tenant
      console.log("setting saml strategy")
      passport.use(tenant.samlStrategy)
      passport.authenticate('saml',
        {
          failureRedirect: '/login/fail'
        }
      )(req,res,next)
    } else {
      res.status(404).json({error: "Tenant ID not found"});
    }
  },
  (req, res) => {
    let tenant = res.locals.tenant
    console.log(`Authorized user ${req.user.nameID} for app ${tenant.description} (ID: ${tenant.appId})`)
    console.log(req.user)
    console.log(req.body)
    // res.json(req.user)
    let token = jwt.sign({
        user: req.user.nameID,
        username: req.user.onpremisessamaccount,
        displayname: req.user.displayname,
        email: req.user['http://schemas.microsoft.com/identity/claims/emailaddress'],
        tenantid: tenant.appId,
      }, tenant.jwtsecret, { 
        issuer: 'authproxy.ath.tamu.edu',
        expiresIn: ( tenant.tokenlife || "2 days" )
      }
    )
    var returnUrl = new URL(tenant['returnUrl'])
    returnUrl.searchParams.append('token', token)
    res.redirect(returnUrl);
  }
);

app.get('/login/fail', 
  function(req, res) {
    res.status(401).send('Login failed');
  }
);

app.get('/authReturnTest',
  function(req, res) {
    let token = req.query.token
    var output = "<h1>Auth proxy test</h1>"
    if(!token) throw "No token provided"
    
    var decodedtoken = jwt.decode(token)

    if(!decodedtoken) throw "Token failed to decode"
    if(!decodedtoken.tenantid) throw "No tenant ID inside token"

    let tenant = findTenantByAppId(decodedtoken.tenantid, tenants)

    if(!tenant) "Invalid or unknown tenant ID"
    console.log(tenant.jwtsecret)

    jwt.verify(token, tenant.jwtsecret, function(err, decoded) {
      if(err) throw err
      output = output + "<p>Token validated successfully</p>"
      output = output + `Token:<br>${JSON.stringify(decoded)}`
    })
      
    res.send(output)
  }
);

app.use(function(err, req, res, next) {
    console.error(err)
    var response = {
      statusCode: err.status || 500,
      error: {
        "code": Utils.isEmpty(err.code) ? 500 : err.code,
        "message": err.message
      }
    };
  
    return res.status(response.statusCode).json(response);
  });
  
app.set('port', process.env.PORT || 3000);
  
var server = app.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + server.address().port+" Environment: ",process.env.ENV);
});
