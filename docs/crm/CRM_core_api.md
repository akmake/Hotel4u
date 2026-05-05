# CRM Core API (Wave 1 Bootstrap)

Base path: `/api/crm`

פרמטר חובה כמעט בכל endpoint: `propertyId` (ב־query או body).

## Overview

- `GET /overview?propertyId=...`

מחזיר ספירות של: `accounts`, `contacts`, `leads`, `opportunities`, `activities`, `tasks`.

## Accounts

- `GET /accounts?propertyId=...&q=...&status=...&page=1&limit=50`
- `POST /accounts`
- `GET /accounts/:id`
- `PATCH /accounts/:id`
- `DELETE /accounts/:id` (soft delete via `active=false`)

## Contacts

- `GET /contacts?propertyId=...&q=...&status=...&page=1&limit=50`
- `POST /contacts`
- `GET /contacts/:id`
- `PATCH /contacts/:id`
- `DELETE /contacts/:id`

## Leads

- `GET /leads?propertyId=...&q=...&status=...&page=1&limit=50`
- `POST /leads`
- `GET /leads/:id`
- `PATCH /leads/:id`
- `DELETE /leads/:id`
- `POST /leads/:id/route`
- `POST /leads/:id/convert`

## Lead Routing Rules

- `GET /lead-routing-rules?propertyId=...`
- `POST /lead-routing-rules`
- `PATCH /lead-routing-rules/:id`
- `DELETE /lead-routing-rules/:id`

## Opportunities

- `GET /opportunities?propertyId=...&q=...&status=...&page=1&limit=50`
- `POST /opportunities`
- `GET /opportunities/:id`
- `PATCH /opportunities/:id`
- `DELETE /opportunities/:id`
- `POST /opportunities/:id/stage`
- `POST /opportunities/:id/health/recalculate`
- `POST /opportunities/:id/close-won`
- `POST /opportunities/:id/close-lost`

## Pipeline

- `GET /pipelines?propertyId=...`
- `POST /pipelines`
- `PATCH /pipelines/:id`
- `DELETE /pipelines/:id`

## Forecast

- `GET /forecast?propertyId=...&pipelineKey=...&ownerId=...&from=YYYY-MM-DD&to=YYYY-MM-DD`

## Activities

- `GET /activities?propertyId=...&q=...&page=1&limit=50`
- `POST /activities`
- `GET /activities/:id`
- `PATCH /activities/:id`
- `DELETE /activities/:id`

## Tasks

- `GET /tasks?propertyId=...&q=...&status=...&page=1&limit=50`
- `POST /tasks`
- `GET /tasks/:id`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id`

## Timeline

- `GET /timeline?propertyId=...&entityType=...&entityId=...&page=1&limit=100`
- `POST /timeline`

Payload required for manual timeline event:

```json
{
  "propertyId": "PROPERTY_ID",
  "entityType": "account",
  "entityId": "ENTITY_ID",
  "eventType": "account.note_added",
  "title": "התווספה הערה"
}
```

## מה כבר מחובר

- Property scope enforcement דרך `assertPropertyScope`.
- Audit log על create/update/delete לכל ישות CRM Core.
- Timeline event אוטומטי על create/update/delete.
