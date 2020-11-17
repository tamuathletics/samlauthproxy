# SPA Authentication Proxy (authproxy)

Authproxy can serve as middleware for SPAs to delegate complex authentication mechanisms to in exchange for a simple JWT.

## How to enroll
An application must be added to the tenant registry first in order to use the `authproxy`. Collaborate with the service provider to enroll your app. You will need to provide:
- a description of your application
- a `returnUrl` where the user will be sent after successful authentication, by default if no other returnUrl is provided

After enrolling, you will be assigned a:
- `loginUrl` where you should redirect unauthenticated users to
- and a secret used to validate JWTs

## How to use

Your application should maintain authentication status of your users, and if a user is found to be unauthenticated or their token expired, your application should 302 redirect them to the `loginUrl` assigned to the app. You may optionally provide a `returnUrl` param to override the default value.

After successful authentication, the user will be 302 redirected to your `returnUrl` with a `token` value in the query string in the format of a JWT. Example:

```
https://redirectUrl/api/v1/authCallback?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoianJhZmZlcnR5QGF0aGxldGljcy50YW11LmVkdSIsImVtYWlsIjoiSm9zZXBoIFJhZmZlcnR5IiwiaWF0IjoxNTkyOTQ3NTQzLCJleHAiOjE1OTMxMjAzNDN9.50ohRazMcG1Otu0UT0j7Lp9TiI_WqluDPKDgW83sw88
```

Your backend should read in this value, validate the signature, and parse for values.

The payload will contain the following values:

| param | description |
| ----- | ----------- |
| `iat` | Time the JWT was issued, in unix epoch seconds |
| `exp` | Time the JWT will expire, in unix epoch seconds |
| `user` | The userPrincipalName of the authenticated user (`username@domain`) |
| `username` | The username of the authenticated user (`sAMAccountName`) |
| `email` | The email address of the authenticated user |

## Security

Your application should follow [best practices](https://stormpath.com/blog/where-to-store-your-jwts-cookies-vs-html5-web-storage) for securely storing this JWT since it's effectively a password. After reading the `token` value from the `returnUrl`, you should redirect the user to another url (such as the root of your SPA) and remove the `token` from the query string.

Your backend should ensure the presented token has a valid signature and that the server's current time is between the issued and expiration dates every time a private resource is accessed.


## Testing

To test or develop this app (not integrating it), you'll need to host a public accessible endpoint for Azure SAML to callback.

I create an ngrok tunnel with: `ngrok http 3000`, and updating the `tenants.json` and the Azure application SAML settings with the https hostname given.

To test, send your browser to `http://localhost:3000/login/1?returnUrl=http://localhost:3000/authReturnTest`. Check the console for any errors.