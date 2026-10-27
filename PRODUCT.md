# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Front-desk staff and hotel management/owners (Hebrew, RTL). Front desk works all day at the screen (check-in/out, rooms); management uses the availability calendar to spot busy days, gaps and to decide on sales and pricing.

## Product Purpose

Hotel PMS (hotel4u): reservations, front desk, availability, housekeeping, kitchen, billing. The availability calendar (`/pms/availability`) must serve two jobs equally: quick scan of busy/free days, and commercial decisions (gaps, options, closures).

## Operating Context

Daily operational use on desktop with live data; business date per property; stay dates are YYYY-MM-DD strings.

## Capabilities and Constraints

- Every calendar day must show: day number, today marker, free rooms, occupancy %, arrivals, departures, rooms on option, closed state.
- Design work on the calendar grid only, same system color palette; no business-data changes.
- Invoices are issued by the external invoicer system; payment provider is mock.

## Brand Commitments

Product name currently Hotel4U in code; no new name or logo approved. Existing system palette (teal accent) is binding. Rejected: earlier five calendar variants (list/timeline/meter/labeled/split), flat colour-only variants, generic "inspired" UI.

## Product Principles

- Real data, no fake values.
- User judges by eye; "better" is not approval.
- Alternatives must differ in structure, not just colour.

## Evidence on Hand

docs/design-handoff.md, docs/product/monthly-availability-board.md.
