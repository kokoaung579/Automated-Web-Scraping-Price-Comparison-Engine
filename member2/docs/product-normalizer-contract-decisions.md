# Product Normalizer Contract Decisions

Status: approved design decisions documented; implementation changes are pending review.

## Scope

This document defines the contract decisions for Step 3 data cleaning and
validation. It does not change the existing frontend schema, backend models,
scrapers, or tests.

The applicable product sources are:

- DummyJSON
- Fake Store API
- Books to Scrape

The Quotes to Scrape Playwright scraper produces quotes, not product records,
so it is outside this product-normalization contract.

## Shared machine-readable contract

Python and TypeScript will consume one shared JSON contract rather than keeping
separate category or store definitions.

The future contract must be repository-level and machine-readable, for example:

```text
contracts/product-normalizer.json
```

The exact file is not created by this documentation-only change. Its design
must support additive updates so that a new approved category can be added once
and consumed by both languages.

The initial approved category values are:

```json
[
  "Audio",
  "Cameras",
  "Gaming",
  "Phones",
  "Other"
]
```

`Other` is an approved fallback, not a license to create additional categories.

## Category mapping layer

Category conversion will be a separate mapping layer between each scraper and
the shared product contract.

Rules:

1. A source-specific category is mapped only through an approved mapping.
2. A missing source category maps to `Other`.
3. An unmapped source category maps to `Other`.
4. No source-specific category is copied directly into the frontend category
   field unless it is already an approved contract value.
5. The mapping data must be loaded from the shared JSON contract, not duplicated
   as independent Python and TypeScript constants.

This allows values such as Fake Store API's `electronics` or Books to Scrape's
book category to be handled without inventing frontend categories.

### Approved source-category mappings

| Source | Source category | Frontend category |
| --- | --- | --- |
| DummyJSON | `smartphones` | `Phones` |
| DummyJSON | `laptops` | `Other` |
| Fake Store API | `electronics` | `Other` |
| Fake Store API | `men's clothing` | `Other` |
| Any applicable source | missing category | `Other` |
| Any applicable source | unmapped category | `Other` |

Books to Scrape currently does not provide a category in the existing scraper
output, so it uses the approved missing-category fallback `Other`.

## Product fields and missing values

The existing frontend Product shape remains unchanged:

```text
product_id
product_name
category
brand
model
description
image_url
product_url
store_id
price
currency
availability
source_type
created_at
updated_at
```

Mapping rules:

- `source_type` is `scraped` for these scraper outputs.
- `product_name` is normalized for surrounding and repeated whitespace.
- `price` must be finite and greater than zero.
- `currency` is uppercased only when the source explicitly supplies a valid
  three-letter code.
- Missing currency remains `null` and causes the existing required-field
  validation to report an error.
- Fake Store API currency remains `null`; its documented product fields do not
  include a currency field. The normalizer must never assume USD or any other
  currency for Fake Store API.
- Accepting a frontend Product record whose currency is unknown requires a
  separate compatibility decision because the current frontend validator
  requires a non-null three-letter currency code.
- Books to Scrape preserves its explicit `GBP` value.
- Missing optional text and URL fields remain `null`.
- Availability is normalized to `in_stock`, `out_of_stock`, `preorder`, or
  `unknown`. Missing availability becomes `unknown`, which is an approved
  frontend value.
- `created_at` and `updated_at` use UTC ISO 8601 timestamps.

## Store and source information

No separate `source_website` Product field will be added.

The existing frontend store structure is:

```text
store_id
store_name
website_url
logo_url
status
created_at
updated_at
```

The backend currently represents stores as non-null string names in Product,
StoreOffer, and StoreHistory models. The frontend Product contract represents
`store_id` as `string | null`, and its validator permits null but validates any
non-null value against the current Store Management data. These are not the
same field or nullability contract, so an integration adapter is required before
normalized frontend records are sent directly to the backend.

Store rules:

1. A managed retailer is represented by its existing `store_id` and its
   existing store record, including `website_url`.
2. The store configuration is extensible; the current managed stores are not a
   permanent hardcoded list.
3. Practice-site sources may use `store_id: null` when no approved managed-store
   mapping exists. This is frontend-compatible, but it is not directly
   compatible with the backend's non-null `store` string fields.
4. A practice-site source must not be converted into a managed store
   automatically.
5. A source name or URL must never be converted into a store ID merely by
   slugging it unless that store record is approved and exists in the store
   configuration.
6. Source identity must remain internally available to the normalization
   pipeline for ID generation, deduplication, diagnostics, and store mapping.
   The current frontend Product shape does not provide a dedicated output field
   for that identity, and no new Product field will be added.

Current managed store examples are `amazon`, `best-buy`, `walmart`, `target`,
`b-h-photo`, `gamestop`, `adorama`, and `samsung`. They are evidence of the
current store shape, not a closed enumeration.

## Product IDs and canonical URL hashing

Existing scraper identity strategy:

- DummyJSON supplies `source_product_id`.
- Fake Store API supplies `source_product_id`.
- Books to Scrape does not supply a reliable source ID but supplies a product
  URL.

The normalization strategy is:

1. Preserve the existing source-aware ID approach when a reliable
   `source_product_id` exists.
2. Use a source-aware SHA-256 hash of a canonical product URL when no reliable
   source ID exists.
3. Include the source identity and approved store identity in the ID namespace
   so products from different sources or stores cannot collide. When
   `store_id` is `null`, use an explicit no-store component rather than
   dropping the source component; the source namespace still distinguishes the
   product.
4. Preserve URL path case because URL paths may be case-sensitive.
5. Lowercase only the URL scheme and hostname.
6. Remove URL fragments because they do not identify a separate server resource.
7. Normalize trailing slashes consistently, while preserving the root path.
8. Sort query parameters only after confirming that the source treats parameter
   order as insignificant; otherwise retain the source's query order.
9. Use the canonical URL consistently for both ID generation and duplicate
   detection.

The current slug-based fallback can collide for different URLs such as
`/A-B` and `/A/B`, and case-folding can merge case-sensitive paths. The future
implementation must replace that URL fallback with canonical URL hashing.

## Duplicate detection

Duplicates are detected using a source-aware identity key:

- source + store + reliable source product ID, or
- source + store + canonical product URL.

Products from different sources or stores must not be merged merely because
their names are similar. URL canonicalization rules above must be applied
before comparing URL identities.

## Verified compatibility values

The current frontend code defines the allowed availability values as:

```text
in_stock
out_of_stock
preorder
unknown
```

This is verified by `PRODUCT_AVAILABILITIES` in `src/data/adminProducts.ts`.
Therefore `unknown` is an evidence-based fallback, not an assumption.

The frontend `Product` type explicitly declares `store_id: string | null`.
However, the frontend validator accepts a non-null store ID only when it exists
in Store Management. The backend models use `store: str` rather than
`store_id: str | None`, so `store_id: null` must not be passed directly into
those backend fields without an approved adapter.

## Test plan

Tests will use mocked HTTP responses for deterministic unit tests and captured
representative records from the real scraper output shape. They must not make
internet access a requirement for the test suite.

Required coverage:

- DummyJSON `smartphones` records normalize to `Phones`.
- DummyJSON `laptops` records normalize to `Other`.
- Fake Store API records keep `currency: null` and report the required-field
  validation issue rather than assuming USD.
- Fake Store API `electronics` and `men's clothing` records normalize to
  `Other`.
- Books to Scrape records preserve `GBP` when supplied and use the `Other`
  category fallback when no approved category is present.
- Missing categories map to `Other`.
- Unmapped categories map to `Other`.
- Practice-site records may retain `store_id: null`.
- Managed store IDs are accepted only when supplied by approved store data.
- Source information used for store/ID resolution is not silently discarded by
  the pipeline.
- Source-ID product IDs remain backward-compatible.
- URL-based IDs are stable across equivalent canonical URLs.
- URL path case does not collide.
- Query and trailing-slash handling is deterministic.
- Duplicate records are removed only when their source-aware identity matches.
- Different sources and stores remain separate products.
- All valid output records contain exactly the frontend Product fields.

## Current compatibility baseline

The existing live scraper outputs were audited before this decision update:

| Source | Records audited | Current pass | Current fail | Current issue |
| --- | ---: | ---: | ---: | --- |
| DummyJSON | 23 | 0 | 23 | Category is absent from the scraper output. |
| Fake Store API | 20 | 0 | 20 | Source categories are not current frontend categories; currency is not provided by the API. |
| Books to Scrape | 1,000 | 0 | 1,000 | Category is absent from the scraper output. |

These failures are expected under the pre-mapping implementation. They must be
retested after the shared contract and category mapping layer are implemented.

## Remaining technical questions

The following points still require explicit implementation approval:

1. Where the shared JSON contract will live and how the frontend build will
   load it without breaking its current TypeScript imports.
2. Whether the store registry itself will move into the shared JSON contract or
   whether the shared contract will contain only source-to-store mapping data.
3. How practice-site source identity should be exposed to downstream consumers
   while retaining it internally and without adding a new frontend Product
   field.
4. Whether an integration adapter should translate frontend `store_id: null`
   into an acceptable backend representation, because the backend currently
   requires a non-null store name string.
5. Whether products with `currency: null` should remain rejected by the current
   frontend required-field validator or be handled by a future contract change.
6. Exact query-parameter canonicalization rules for each source before URL
   hashing is finalized.

No category, store ID, currency, availability, or source field has been
fabricated in this decision document.
