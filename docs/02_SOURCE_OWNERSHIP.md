# Source Ownership and Precedence

## 1. Core rule

The CMS unifies access and publication. It does not automatically become the owner of every field.

## 2. Domain ownership

| Domain | Canonical owner | CMS behavior |
|---|---|---|
| Bookings and payment status | Operational PostgreSQL | Read-only |
| Package identity and operational relations | PostgreSQL package tables | Controlled operational edit |
| Package public narrative | CMS version | Editable and publishable |
| Package readiness | llm-wiki release | Read-only validation input |
| Route feasibility | itinerary-core release | Read-only derived input |
| Destination operational facts | PostgreSQL destinations | Controlled operational edit |
| Destination public narrative | CMS version | Editable |
| Canonical claims | narrative claims / llm-wiki | Approval-controlled |
| Evidence and proof | Asset/document registry | Metadata governed; verified file immutable |
| Machine policy rules | Structured PostgreSQL rules | Compliance-restricted |
| Public policy documents | CMS policy version | Compliance approval required |
| Visual tokens/components | Runtime code and approved design release | Read-only selection |
| Route implementation | jvto-web code and page registry | Developer-owned |
| Blog authoring | llm-wiki | Import published content |
| Public people profiles | CMS profile | Editable |
| Private crew data | Operational PostgreSQL | Restricted; never public |

## 3. Write policies

- `read_only`
- `editable`
- `override_with_approval`
- `operational_only`
- `developer_only`
- `compliance_only`

## 4. Conflict policies

- `block`
- `warn`
- `prefer_owner`
- `manual_resolution`
- `create_new_version`

## 5. Precedence algorithm

1. Reject data that fails security, manifest, checksum, or schema validation.
2. Resolve the canonical entity.
3. Look up field ownership.
4. Compare the incoming source to the owner source.
5. Apply write and conflict policy.
6. Stage non-owner values as proposals or evidence.
7. Never silently replace owner values.
8. Require approval for governed overrides.

## 6. Canonical page versus display surface

Canonical pages own full truth. Display surfaces reference approved subsets.

Examples:

- Legal proof is owned by `/verify-jvto/legal`.
- Homepage badges reference the proof record and never duplicate legal content.
- Ijen screening is owned by the travel-guide screening page.
- Package pages show a compact linked notice.
