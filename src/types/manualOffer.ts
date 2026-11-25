import type { Availability } from './comparison'

export type ManualOfferAvailability = Availability

export type ManualOfferRecord = {
  offer_id: string
  product_id: string
  store: string
  store_id: string | null
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
  verification_note: string | null
  last_checked_at: string | null
  updated_at: string | null
  is_test_site: boolean
}

export type ManualOfferVerificationRequest = {
  availability: ManualOfferAvailability
  evidence_url?: string | null
  verification_note?: string | null
}
