
import type { AdminStore } from '../data/adminStores'

export type StoreWithProductCount = AdminStore & {
  product_count: number
}

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed: HTTP ${response.status}`

    try {
      const data = await response.json()
      message = data.detail || data.message || message
    } catch {
      // Keep the default error message.
    }

    throw new Error(message)
  }

  return response.json() as Promise<T>
}

// GET: Load stores
export async function getStores(): Promise<StoreWithProductCount[]> {
  const response = await fetch(`${API_BASE_URL}/api/admin/stores`)
  const data = await handleResponse<unknown>(response)

  if (!Array.isArray(data)) {
    throw new Error('Invalid store API response.')
  }

  return data as StoreWithProductCount[]
}

// POST: Create store
export async function createStore(
  store: AdminStore,
): Promise<{ message: string; store: AdminStore }> {
  const response = await fetch(`${API_BASE_URL}/api/admin/stores`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(store),
  })

  return handleResponse(response)
}

// PUT: Update store
export async function updateStore(
  storeId: string,
  store: AdminStore,
): Promise<{ message: string; store: AdminStore }> {
  const response = await fetch(
    `${API_BASE_URL}/api/admin/stores/${encodeURIComponent(storeId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(store),
    },
  )

  return handleResponse(response)
}

// DELETE: Delete store
export async function deleteStore(
  storeId: string,
): Promise<{ message: string; store_id: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/admin/stores/${encodeURIComponent(storeId)}`,
    {
      method: 'DELETE',
    },
  )

  return handleResponse(response)
}
