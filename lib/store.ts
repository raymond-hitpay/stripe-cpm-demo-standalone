import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Cart Store - Shopping cart management
// ============================================================================

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  image: string;
  // Subscription fields
  type?: 'one_time' | 'subscription';
  stripePriceId?: string;       // Stripe Price ID for subscriptions
  interval?: 'month' | 'year';  // Billing interval
  intervalCount?: number;       // e.g., 1 for monthly
}

export interface CartItem extends Product {
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product: Product) => {
        set((state) => {
          const existingItem = state.items.find((item) => item.id === product.id);
          if (existingItem) {
            return {
              items: state.items.map((item) =>
                item.id === product.id
                  ? { ...item, quantity: item.quantity + 1 }
                  : item
              ),
            };
          }
          return {
            items: [...state.items, { ...product, quantity: 1 }],
          };
        });
      },

      removeItem: (productId: string) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== productId),
        }));
      },

      updateQuantity: (productId: string, quantity: number) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === productId ? { ...item, quantity } : item
          ),
        }));
      },

      clearCart: () => {
        set({ items: [] });
      },

      getTotal: () => {
        return get().items.reduce(
          (total, item) => total + item.price * item.quantity,
          0
        );
      },

      getItemCount: () => {
        return get().items.reduce((count, item) => count + item.quantity, 0);
      },
    }),
    {
      name: 'cart-storage',
    }
  )
);

// Dummy product data
export const products: Product[] = [
  {
    id: 'prod_1',
    name: 'Artisan Sourdough Bread',
    description: 'Freshly baked sourdough with a crispy golden crust and soft, tangy interior.',
    price: 890, // $8.90 in cents
    currency: 'sgd',
    image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&h=400&fit=crop',
    type: 'one_time',
  },
  {
    id: 'prod_2',
    name: 'Raw Manuka Honey',
    description: 'Premium New Zealand Manuka honey with rich, earthy flavour and natural benefits.',
    price: 2990, // $29.90 in cents
    currency: 'sgd',
    image: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=400&h=400&fit=crop',
    type: 'one_time',
  },
  {
    id: 'prod_3',
    name: 'Single Origin Coffee Beans',
    description: 'Ethiopian Yirgacheffe specialty roast with bright, fruity notes.',
    price: 2490, // $24.90 in cents
    currency: 'sgd',
    image: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&h=400&fit=crop',
    type: 'one_time',
  },
  {
    id: 'prod_4',
    name: 'Handmade Italian Pasta',
    description: 'Bronze-cut artisan pasta made with durum wheat semolina.',
    price: 1290, // $12.90 in cents
    currency: 'sgd',
    image: 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=400&h=400&fit=crop',
    type: 'one_time',
  },
  {
    id: 'prod_5',
    name: 'Extra Virgin Olive Oil',
    description: 'Cold-pressed from Tuscan olives with a peppery finish and golden hue.',
    price: 1990, // $19.90 in cents
    currency: 'sgd',
    image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=400&fit=crop',
    type: 'one_time',
  },
];

// Subscription products are now fetched dynamically from Stripe Dashboard
// See /app/api/products/route.ts for the API that fetches products from Stripe
