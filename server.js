var express = require("express");
var logger = require('morgan');
var bodyParser = require('body-parser');
var fs = require('fs');
var Utils = require('./utils');
var jwt = require("jsonwebtoken")
var app = express();

var passport = require('passport');
var saml = require('passport-saml');

passport.serializeUser(function(user, done) {
    done(null, user);
});
  
passport.deserializeUser(function(user, done) {
    done(null, user);
});


let tenantRawData = fs.readFileSync('./tenants.json')
let tenants = JSON.parse(tenantRawData)

tenants.forEach(tenant => {
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

var findTenantByAppId = ( id => {
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
    res.status(301).redirect('https://helpdesk.athletics.tamu.edu')
})

app.get('/login/:appid',
  function (req, res, next) {
    let appid = req.params.appid
    let tenant = findTenantByAppId(appid)
    if(tenant) {
      console.log(`Login request for tenant '${tenant.description}' (ID: ${appid})`)
      passport.use(tenant.samlStrategy)
      passport.authenticate('saml', { failureRedirect: '/login/fail' })(req,res,next)
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
    let tenant = findTenantByAppId(req.params.appid)
    if(tenant) {
      res.locals.tenant = tenant
      console.log("setting saml strategy")
      passport.use(tenant.samlStrategy)
      passport.authenticate('saml', { failureRedirect: '/login/fail' })(req,res,next)
    } else {
      res.status(404).json({error: "Tenant ID not found"});
    }
  },
  (req, res) => {
    let tenant = res.locals.tenant
    console.log(`Authorized user ${req.user.nameID} for app ${tenant.description} (ID: ${tenant.appId})`)
    console.log(req.user)
    // res.json(req.user)
    let token = jwt.sign({
        user: req.user.nameID,
        username: req.user.onpremisessamaccount,
        email: req.user['http://schemas.microsoft.com/identity/claims/emailaddress'],
      }, tenant.jwtsecret, { 
        issuer: 'authproxy.ath.tamy.edu',
        expiresIn: "2 days"
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
