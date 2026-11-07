import { createBrowserRouter, Link } from 'react-router'
import { AppShell, TripLayout } from './ui/shell'
import { AuthPage, VerifyEmail } from './features/auth'

import { Root, Protected } from './app'
export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      ...(
        ['login', 'register', 'forgot-password', 'reset-password'] as const
      ).map((kind) => ({
        path: `/${kind}`,
        element: <AuthPage key={kind} kind={kind} />,
      })),
      {
        path: '/verify-email',
        element: <VerifyEmail />,
      },
      {
        path: '/join/:token',
        lazy: async () => ({
          Component: (await import('./features/trips')).JoinTrip,
        }),
      },
      {
        element: <Protected />,
        children: [
          {
            element: <AppShell />,
            children: [
              {
                path: '/',
                lazy: async () => ({
                  Component: (await import('./features/trips')).MyTrips,
                }),
              },
              {
                path: '/account',
                lazy: async () => ({
                  Component: (await import('./features/account')).Account,
                }),
              },
              {
                path: '/trips/:tripId',
                element: <TripLayout />,
                children: [
                  {
                    index: true,
                    lazy: async () => ({
                      Component: (await import('./features/itinerary'))
                        .Itinerary,
                    }),
                  },
                  {
                    path: 'wishes',
                    lazy: async () => ({
                      Component: (await import('./features/wishlist')).Wishlist,
                    }),
                  },
                  {
                    path: 'history',
                    lazy: async () => ({
                      Component: (await import('./features/itinerary'))
                        .TripHistory,
                    }),
                  },
                  {
                    path: 'ledger',
                    lazy: async () => ({
                      Component: (await import('./features/ledger')).Ledger,
                    }),
                  },
                  {
                    path: 'packing',
                    lazy: async () => ({
                      Component: (await import('./features/packing')).Packing,
                    }),
                  },
                  {
                    path: 'more',
                    lazy: async () => {
                      const { TripPlaceholder } =
                        await import('./features/trips')
                      return {
                        Component: () => <TripPlaceholder title="更多" />,
                      }
                    },
                  },
                  {
                    path: 'members',
                    lazy: async () => ({
                      Component: (await import('./features/trip-management'))
                        .Members,
                    }),
                  },
                  {
                    path: 'settings',
                    lazy: async () => ({
                      Component: (await import('./features/trip-management'))
                        .TripSettings,
                    }),
                  },
                  {
                    path: 'polls',
                    lazy: async () => ({
                      Component: (await import('./features/polls')).Polls,
                    }),
                  },
                  {
                    path: 'polls/:pollId',
                    lazy: async () => ({
                      Component: (await import('./features/polls')).Polls,
                    }),
                  },
                  {
                    path: 'documents',
                    lazy: async () => ({
                      Component: (await import('./features/vouchers')).Vouchers,
                    }),
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        path: '*',
        element: (
          <main className="page">
            <h1>页面不存在</h1>
            <Link to="/">返回首页</Link>
          </main>
        ),
      },
    ],
  },
])
