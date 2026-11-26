export type Product = {
  product_id: string
  product_name: string
  category: string
  brand: string | null
  model: string | null
  description: string | null
  image_url: string | null
  product_url: string | null
  store_id: string | null
  store_name?: string | null
  store_website_url?: string | null
  price: number
  currency: string
  availability: string
  source_type: 'scraped' | 'manual'
  created_at: string
  updated_at: string
}
