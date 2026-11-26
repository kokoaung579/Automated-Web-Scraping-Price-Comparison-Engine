import type { Availability } from './comparison'

export type ManualOfferAvailability = Availability

export type ManualOfferEvidenceType =
  | 'product_url'
  | 'offline_document'
  | 'store_website_url'

export type ManualOfferRecord = {
  offer_id: string
  product_id: string
  store: string
  store_id: string | null
  store_name: string | null
  store_website_url: string | null
  price: number
  currency: string | null
  product_url: string | null
  availability: ManualOfferAvailability
  catalog_availability: ManualOfferAvailability | null
  source_type: string
  verification_status: string
  verified: boolean
  verified_by: string | null
  verified_at: string | null
  evidence_url: string | null
  evidence_type: ManualOfferEvidenceType | null
  product_url_evidence: string | null
  offline_description: string | null
  offline_reference: string | null
  match_confirmed: boolean
  verification_note: string | null
  last_checked_at: string | null
  updated_at: string | null
  is_test_site: boolean
}

export type ManualOfferVerificationRequest = {
  availability: ManualOfferAvailability
  evidence_type?: ManualOfferEvidenceType | null
  evidence_url?: string | null
  product_url?: string | null
  store_website_url?: string | null
  offline_description?: string | null
  offline_reference?: string | null
  match_confirmed?: boolean
  verification_note?: string | null
}
