# infra/ — Infrastructure as Code

Terraform + Docker (ECS). **KHÔNG dùng Kubernetes** theo Brief P4/P5.
Mọi thay đổi infra phải qua CI/CD, không tự apply từ local.
Chỉ chuyển sang K8s khi vượt 50.000 hội thoại/tháng (đo bằng dashboard P19).

## Cấu trúc

```
infra/
├── terraform/                       — Terraform IaC
│   ├── main.tf                      — Entry point
│   ├── variables.tf                 — Variable definitions
│   ├── outputs.tf                   — Output values
│   ├── environments/
│   │   ├── dev.tfvars               — dev env (hạn chế)
│   │   ├── staging.tfvars           — staging (production-like)
│   │   └── production.tfvars        — production (CÁCH BỊ KHÓA)
│   │
│   ├── modules/
│   │   ├── aws-rds/                 — PostgreSQL RDS
│   │   ├── aws-elasticache/         — Redis (Bull queue)
│   │   ├── aws-ecr/                 — ECR repos
│   │   ├── aws-ecs/                 — ECS cluster + services
│   │   ├── aws-iam/                 — IAM roles (least privilege)
│   │   ├── aws-vpc/                 — VPC + subnets + security groups
│   │   └── aws-s3/                  — S3 buckets (logs, backups)
│   │
│   ├── backend.tf                   — Terraform state (S3 + lock DynamoDB)
│   └── .gitignore                   — terraform.tfvars (không commit)
│
├── docker/
│   ├── Dockerfile.api               — Multi-stage
│   ├── Dockerfile.worker            — Multi-stage
│   ├── Dockerfile.admin             — Multi-stage
│   ├── docker-compose.dev.yml       — Local dev (không production)
│   └── .dockerignore
│
├── scripts/
│   ├── deploy.sh                    — CI/CD deploy script (không tay)
│   ├── migrate.sh                   — Database migration (migration_role)
│   ├── rollback.sh                  — Rollback strategy
│   ├── health-check.sh              — Readiness probe
│   └── backup.sh                    — Daily backup (cron)
│
├── monitoring/
│   ├── prometheus-rules.yaml        — Alert rules (RLS, PII, org breach)
│   ├── grafana-dashboard.json       — Dashboard
│   └── alerts.md                    — Alert threshold & runbook
│
└── README.md                        — Infra overview
```

## Quy tắc

### 1. Terraform

#### State management

- State file: S3 backend + DynamoDB lock
- Không commit state file
- Chỉ CI/CD apply (không local)
- Secret: encrypt tại AWS KMS

#### Resource naming

```hcl
# Pattern: {project}-{env}-{resource}-{serial}
resource "aws_db_instance" "postgres" {
  identifier = "gani-platform-chat-${var.environment}-postgres"
  # ...
}
```

#### Variable scope

- `dev`: Minimal (t2.micro, small DB)
- `staging`: Production-like (match prod config nhưng khác zone)
- `production`: Cực kỳ giới hạn (CÁCH BỊ KHÓA)

#### IAM Principle of Least Privilege

- App role: `s3:GetObject` từ bucket riêng (không ListAll)
- Worker role: SQS queue riêng (không cross-workspace)
- Migration role: `postgres_superuser` nhưng chỉ trong migration_role (không app_role)

### 2. Docker

#### Multi-stage build

```dockerfile
# Stage 1: build
FROM node:20-alpine AS builder
COPY . .
RUN pnpm install && pnpm build

# Stage 2: runtime
FROM node:20-alpine
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules /app/node_modules
CMD ["node", "dist/index.js"]
```

#### Image size

- API image: < 200MB
- Worker image: < 200MB
- Admin image: < 300MB
- Scan: `trivy image` trước push

### 3. ECS Deployment (AWS)

- Task definition: `gani-platform-chat-{service}-{env}` (API, Worker, Admin)
- Task role: IAM least privilege (chỉ S3/RDS/SQS cần thiết)
- Network: VPC private subnets, security group chặt
- Load Balancer: ALB (staging) / NLB (production nếu cần latency thấp)

### 4. Migration (Zero-downtime)

```bash
# 1. Deploy code v2 (chưa chạy migration)
# 2. Chạy migration (expand phase)
# 3. Rollback nếu fail
# 4. Khi stable → migrate (contract phase)
```

### 5. Deployment strategy (ECS)

#### CI/CD flow

```
GitHub PR
  ↓ (test pass)
Merge → main
  ↓
Build image + scan
  ↓
Push ECR
  ↓
Deploy staging (auto)
  ↓ (smoke test pass)
Create GitHub Release
  ↓
Manual approval (deploy prod)
  ↓
Deploy production (blue-green)
  ↓ (health check pass)
Promote (traffic 100% → green)
```

#### Rollback

```bash
# Nếu production fail
./infra/scripts/rollback.sh production [previous-tag]
# → Terrafom destroy + recreate từ previous state
# → ECS task rollback tới previous image
```

### 6. Backup & Disaster Recovery

#### Database backup

```bash
# Nightly S3 backup (cron)
aws rds create-db-snapshot --db-instance-identifier gani-platform-chat-prod-postgres

# Retain 30 days
aws s3 lifecycle put-bucket-lifecycle-configuration
```

#### RTO / RPO

- **RTO** (Recovery Time Objective): < 1 giờ
- **RPO** (Recovery Point Objective): < 1 giờ (nightly backup + binary log)

### 7. Monitoring & Alert

#### Metrics

- CPU / Memory / Disk
- DB connection pool
- Queue length (Bull)
- API latency (p50/p95/p99)
- Error rate (5xx, RLS violation, PII log)
- Org breach attempt (cross-tenant query)

#### Alert thresholds

| Metric | Threshold | Action |
|---|---|---|
| RLS policy fail | ≥ 1/min | Page oncall, check DB logs |
| PII log | ≥ 1 instance | Page oncall CRITICAL |
| Org breach | ≥ 1 attempt | Page oncall CRITICAL, audit trail |
| Claim race fail | ≥ 1 instance | Page oncall, check FSM |
| Queue length | > 10k | Scale worker, check DB |
| DB CPU | > 80% | Scale DB, check slow queries |
| API p99 latency | > 5s | Check database, cache hit rate |

## Cấm

- Không SSH vào production instance để debug
- Không `terraform apply` từ local (chỉ CI/CD)
- Không commit `.tfvars` với secret
- Không xóa snapshot / backup nếu chưa kiểm chứng restore
- Không change security group rules từ console (chỉ Terraform)
- Không scale database từ tay (chỉ Terraform + CI/CD)

## Khi sửa infra

1. Sửa trong `infra/terraform/modules/*`
2. Test locally: `terraform plan -var-file=environments/dev.tfvars`
3. Gửi PR, chạy `terraform plan` trong CI
4. Merge → staging auto-deploy (kiểm chứng)
5. Sau khi staging stable → manual approval prod
6. Deploy prod: blue-green (không downtime)

## Contacts

- DB trouble → kiểm tra `infra/terraform/modules/aws-rds/`
- Queue trouble → kiểm tra `infra/terraform/modules/aws-elasticache/`
- Security breach → kiểm tra IAM policy + VPC security group
- Backup fail → kiểm tra S3 lifecycle + RDS snapshot policy

## Ghi chú

- Production Terraform state bị LOCK từ IAM: chỉ CI/CD có quyền apply
- Không có local access vào `.tfvars` production
- Secret được encrypt AWS KMS
- Nếu vượt 50k hội thoại/tháng → thăng K8s lên staging/prod (review lại Architecture Decision Record)
