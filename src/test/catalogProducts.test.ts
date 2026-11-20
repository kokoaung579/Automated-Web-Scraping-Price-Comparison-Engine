import { describe, expect, it } from 'vitest'
import { mergeCatalogProducts } from '../data/catalogProducts'
import { products } from '../data/products'

describe('catalog products', () => {
  it('keeps the catalog price when a matching Channel3 result is found', () => {
    const catalogProduct = products[0]
    const matchingChannel3Product = {
      ...catalogProduct,
      id: 'channel3-sony-wh-1000xm5',
      price: 10,
      previousPrice: 12,
      store: 'External Store',
      externalOfferUrl: 'https://example.test/sony',
    }
    const unmatchedChannel3Product = {
      ...catalogProduct,
      id: 'channel3-unmatched',
      name: 'Unmatched Product',
      brand: 'Other',
      price: 20,
      previousPrice: 25,
    }

    const merged = mergeCatalogProducts(
      [catalogProduct],
      [matchingChannel3Product, unmatchedChannel3Product],
    )

    expect(merged).toHaveLength(2)
    expect(merged[0]).toBe(catalogProduct)
    expect(merged[0]).toMatchObject({
      price: catalogProduct.price,
      previousPrice: catalogProduct.previousPrice,
      store: catalogProduct.store,
    })
    expect(merged[1]).toBe(unmatchedChannel3Product)
  })

  it('does not merge by name when a required identity field differs or is missing', () => {
    const catalogProduct = products[0]
    const differentModel = {
      ...catalogProduct,
      id: 'channel3-different-model',
      specifications: catalogProduct.specifications.map((specification) =>
        specification.label === 'Model'
          ? { ...specification, value: 'WH-1000XM4' }
          : specification,
      ),
    }
    const missingModel = {
      ...catalogProduct,
      id: 'channel3-missing-model',
      specifications: catalogProduct.specifications.filter(
        (specification) => specification.label !== 'Model',
      ),
    }
    const differentCategory = {
      ...catalogProduct,
      id: 'channel3-different-category',
      category: 'Consumer Electronics',
    }

    const merged = mergeCatalogProducts(
      [catalogProduct],
      [differentModel, missingModel, differentCategory],
    )

    expect(merged).toHaveLength(4)
    expect(merged.slice(1)).toEqual([
      differentModel,
      missingModel,
      differentCategory,
    ])
  })
})
