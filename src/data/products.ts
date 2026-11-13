import {
  Camera,
  Ear,
  Gamepad2,
  Headphones,
  Smartphone,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type Product = {
  id: string
  name: string
  brand: string
  category: string
  store: string
  price: number
  previousPrice: number
  updated: string
  updatedAt: string
  specifications: { label: string; value: string }[]
  icon: LucideIcon
  tone: string
}

export const products: Product[] = [
  {
    id: 'sony-wh-1000xm5',
    name: 'Sony WH-1000XM5',
    brand: 'Sony',
    category: 'Audio',
    store: 'Amazon',
    price: 328,
    previousPrice: 379.99,
    updated: '12 min ago',
    updatedAt: '2026-11-13T13:04:00+06:30',
    specifications: [
      { label: 'Model', value: 'WH-1000XM5' },
      { label: 'Type', value: 'Wireless noise-canceling headphones' },
      { label: 'Battery life', value: 'Up to 30 hours' },
      { label: 'Connectivity', value: 'Bluetooth 5.2' },
    ],
    icon: Headphones,
    tone: 'text-blue-200 from-blue-400/20 to-blue-500/5',
  },
  {
    id: 'bose-quietcomfort-ultra',
    name: 'Bose QuietComfort Ultra',
    brand: 'Bose',
    category: 'Audio',
    store: 'Best Buy',
    price: 349,
    previousPrice: 329,
    updated: '18 min ago',
    updatedAt: '2026-11-13T12:58:00+06:30',
    specifications: [
      { label: 'Model', value: 'QuietComfort Ultra' },
      { label: 'Type', value: 'Wireless noise-canceling headphones' },
      { label: 'Audio', value: 'Immersive Audio' },
      { label: 'Battery life', value: 'Up to 24 hours' },
    ],
    icon: Headphones,
    tone: 'text-amber-200 from-amber-400/20 to-amber-500/5',
  },
  {
    id: 'apple-airpods-pro-2',
    name: 'Apple AirPods Pro 2',
    brand: 'Apple',
    category: 'Audio',
    store: 'Walmart',
    price: 189.99,
    previousPrice: 199,
    updated: '28 min ago',
    updatedAt: '2026-11-13T12:48:00+06:30',
    specifications: [
      { label: 'Model', value: 'AirPods Pro (2nd generation)' },
      { label: 'Type', value: 'Wireless in-ear headphones' },
      { label: 'Audio', value: 'Active Noise Cancellation' },
      { label: 'Charging case', value: 'USB-C MagSafe case' },
    ],
    icon: Ear,
    tone: 'text-slate-200 from-slate-300/15 to-slate-500/5',
  },
  {
    id: 'nintendo-switch-oled',
    name: 'Nintendo Switch OLED',
    brand: 'Nintendo',
    category: 'Gaming',
    store: 'Target',
    price: 319.99,
    previousPrice: 349.99,
    updated: '42 min ago',
    updatedAt: '2026-11-13T12:34:00+06:30',
    specifications: [
      { label: 'Display', value: '7-inch OLED touchscreen' },
      { label: 'Storage', value: '64 GB internal storage' },
      { label: 'Modes', value: 'TV, tabletop, and handheld' },
      { label: 'Color', value: 'White Joy-Con' },
    ],
    icon: Gamepad2,
    tone: 'text-rose-200 from-rose-400/20 to-rose-500/5',
  },
  {
    id: 'canon-eos-r50',
    name: 'Canon EOS R50',
    brand: 'Canon',
    category: 'Cameras',
    store: 'B&H Photo',
    price: 679,
    previousPrice: 699,
    updated: '1 hr ago',
    updatedAt: '2026-11-13T12:16:00+06:30',
    specifications: [
      { label: 'Sensor', value: '24.2 MP APS-C CMOS' },
      { label: 'Video', value: '4K UHD recording' },
      { label: 'Type', value: 'Mirrorless camera' },
      { label: 'Lens mount', value: 'Canon RF / RF-S' },
    ],
    icon: Camera,
    tone: 'text-violet-200 from-violet-400/20 to-violet-500/5',
  },
  {
    id: 'samsung-galaxy-s24',
    name: 'Samsung Galaxy S24',
    brand: 'Samsung',
    category: 'Phones',
    store: 'Amazon',
    price: 699.99,
    previousPrice: 749.99,
    updated: '2 hrs ago',
    updatedAt: '2026-11-13T11:16:00+06:30',
    specifications: [
      { label: 'Display', value: '6.2-inch Dynamic AMOLED 2X' },
      { label: 'Storage', value: '128 GB' },
      { label: 'Camera', value: '50 MP main camera' },
      { label: 'Connectivity', value: '5G, Wi-Fi 6E, Bluetooth 5.3' },
    ],
    icon: Smartphone,
    tone: 'text-emerald-200 from-emerald-400/20 to-emerald-500/5',
  },
]
