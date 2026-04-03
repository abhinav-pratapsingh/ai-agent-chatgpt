module.exports = {
  apps: [
    {
      name: "ai-outreach-api",
      script: "./server.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      max_memory_restart: "500M",
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        PORT: 6080,
        START_MODE: "api"
      }
    },
    {
      name: "ai-outreach-agent",
      script: "./scheduler/campaignScheduler.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      max_memory_restart: "750M",
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        START_MODE: "scheduler"
      }
    }
  ]
};
