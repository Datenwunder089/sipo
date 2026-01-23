# Learning Log

## 2026-01-17: Starting the Documenso Instance

### Quick Start Commands

```bash
# 1. Start Docker containers (database, mail server, minio)
cd /home/azureuser/documenso
npm run dx:up

# 2. Start the development server (accessible only locally)
npm run dev

# 3. Start the development server (accessible externally via IP)
cd /home/azureuser/documenso/apps/remix
npm run with:env -- react-router dev --host 0.0.0.0
```

### Service URLs

| Service | URL | Port |
|---------|-----|------|
| Web Application | http://localhost:3000 or http://135.225.105.52:3000 | 3000 |
| PostgreSQL Database | localhost:54320 | 54320 |
| Mail Server (SMTP) | localhost:2500 | 2500 |
| Mail Server (Web UI) | localhost:9000 | 9000 |
| MinIO Console | localhost:9001 | 9001 |

### Important Notes

1. **External Access**: By default, `npm run dev` only listens on localhost. To expose externally, use the `--host 0.0.0.0` flag.

2. **Azure NSG**: If running on Azure, ensure port 3000 is open in the Network Security Group (NSG) for external access.

3. **Port Conflicts**: If port 3000 is already in use, kill the existing process:
   ```bash
   sudo lsof -ti:3000 | xargs -r sudo kill -9
   ```

4. **Check Server Logs**:
   ```bash
   tail -f /tmp/documenso-dev.log
   ```

5. **Docker Container Status**:
   ```bash
   docker ps
   ```

### Troubleshooting

- **Server won't start**: Check if Docker containers are running with `docker ps`
- **Can't access externally**: Verify server is listening on all interfaces with `sudo lsof -i:3000` (should show `*:3000`)
- **Database issues**: Check container health with `docker ps` - database may show "unhealthy" during startup
