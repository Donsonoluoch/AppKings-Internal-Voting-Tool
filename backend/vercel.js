{
  "version": 2,
  "builds": [
    {
      "src": "src/vercel.js",
      "use": "@vercel/node",
      "config": {
        "includeFiles": ["prisma/**", "node_modules/.prisma/**"]
      }
    }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "src/vercel.js" }
  ]
}