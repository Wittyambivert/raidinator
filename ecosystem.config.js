module.exports = {
  apps: [{
    name: 'raidinator',
    script: 'dist/index.js',
    watch: false,
    max_restarts: 5,
    restart_delay: 60000,
    max_memory_restart: '256M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
