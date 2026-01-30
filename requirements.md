# Admin Panel Requirements

## Overview

Build an admin panel for the Revamp proxy to manage domain profiles, client configurations, and monitor system metrics through a modern web interface.

## Architecture Decision

**Approach**: Hybrid file-based HTML/CSS/JS served from `public/admin/`

**Rationale**:
- Consistent with existing lightweight architecture
- No new build pipeline required
- Vanilla JS keeps bundle size minimal
- File-based organization improves maintainability over inline HTML
- Can be served directly by existing HTTP proxy

## Design System

Follow existing Revamp design language:

**Colors**:
- Background: `#1a1a2e`, `#16213e`, `#0f3460` (dark gradient)
- Primary: `#3b82f6` (blue)
- Secondary: `#7b2cbf` (purple)
- Accent: `#00d4ff` (cyan)
- Success: `#4ade80` (green)
- Warning: `#fbbf24` (amber)
- Error: `#ff4444` (red)
- Text: `#ffffff`, `rgba(255,255,255,0.7)`

**Visual Style**:
- Glassmorphism cards (`backdrop-filter: blur(10px)`)
- Rounded corners (`border-radius: 16px`)
- Subtle borders (`rgba(255,255,255,0.1)`)
- Gradient accents
- Smooth transitions

## Pages

### 1. Dashboard (`/admin/` or `/admin/index.html`)

**Purpose**: Overview of proxy status and quick actions

**Components**:
- System status header (uptime, version)
- Metrics summary cards:
  - Total requests
  - Active connections
  - Cache hit rate
  - Bandwidth (in/out)
  - Blocked requests
- Transformation stats (JS/CSS/HTML/Images)
- Quick links to other admin pages
- Recent activity log (if available)

**Data Source**: `GET /__revamp__/metrics/json`

**Refresh**: Auto-refresh every 5 seconds (configurable)

### 2. Domain Profiles (`/admin/domains.html`)

**Purpose**: CRUD management for domain-specific rules

**Components**:
- Profile list table:
  - Name
  - Patterns (truncated)
  - Priority
  - Status (enabled/disabled toggle)
  - Actions (edit/delete)
- "Create New Profile" button
- Search/filter input
- Bulk actions (enable all, disable all)

**Profile Editor Modal/Panel**:
- Name input
- Patterns editor:
  - Type dropdown (exact/suffix/regex)
  - Pattern input
  - Add/remove pattern buttons
- Priority slider/input
- Transform toggles:
  - transformJs
  - transformCss
  - transformHtml
  - bundleEsModules
  - emulateServiceWorkers
  - remoteServiceWorkers
  - injectPolyfills
- Filtering toggles:
  - removeAds
  - removeTracking
- Custom patterns (advanced):
  - Custom ad patterns (textarea)
  - Custom ad selectors (textarea)
  - Custom tracking patterns (textarea)
  - Custom tracking selectors (textarea)
- Enabled toggle
- Save/Cancel buttons

**Domain Tester**:
- Input field to test domain
- "Test Match" button
- Shows which profile matches (or none)

**Data Source**:
- `GET /__revamp__/domains` - List profiles
- `POST /__revamp__/domains` - Create profile
- `GET /__revamp__/domains/:id` - Get profile
- `PUT /__revamp__/domains/:id` - Update profile
- `DELETE /__revamp__/domains/:id` - Delete profile
- `GET /__revamp__/domains/match/:domain` - Test matching

### 3. Client Configuration (`/admin/config.html`)

**Purpose**: View and modify proxy client settings

**Components**:
- Current config display (card format)
- Toggle switches for each option:
  - transformJs
  - transformCss
  - transformHtml
  - bundleEsModules
  - emulateServiceWorkers
  - remoteServiceWorkers
  - removeAds
  - removeTracking
  - injectPolyfills
  - spoofUserAgent
  - spoofUserAgentInJs
- "Save Changes" button
- "Reset to Defaults" button
- Config JSON preview (collapsible)

**Data Source**:
- `GET /__revamp__/config` - Get current config
- `POST /__revamp__/config` - Update config
- `DELETE /__revamp__/config` - Reset to defaults

### 4. Service Workers (`/admin/sw.html`)

**Purpose**: Monitor and manage Service Worker handling

**Components**:
- Remote SW status display:
  - Server status (running/stopped)
  - Connected clients count
  - Active workers count
- SW mode toggle (emulate vs remote)
- Connection list (if remote mode)
- Bundle endpoint info

**Data Source**: `GET /__revamp__/sw/remote/status`

## File Structure

```
public/
├── revamp-logo.png
└── admin/
    ├── index.html          # Dashboard
    ├── domains.html        # Domain profiles
    ├── config.html         # Client configuration
    ├── sw.html             # Service Workers
    ├── css/
    │   └── admin.css       # Shared styles
    └── js/
        ├── api.js          # API client utilities
        ├── components.js   # Reusable UI components
        ├── dashboard.js    # Dashboard logic
        ├── domains.js      # Domain profiles logic
        ├── config.js       # Config page logic
        └── sw.js           # SW page logic
```

## API Integration

### API Client (`api.js`)

```javascript
const RevampAPI = {
  baseUrl: '/__revamp__',

  // Metrics
  getMetrics: () => fetch(`${baseUrl}/metrics/json`).then(r => r.json()),

  // Config
  getConfig: () => fetch(`${baseUrl}/config`).then(r => r.json()),
  updateConfig: (data) => fetch(`${baseUrl}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  resetConfig: () => fetch(`${baseUrl}/config`, { method: 'DELETE' }),

  // Domains
  getDomains: () => fetch(`${baseUrl}/domains`).then(r => r.json()),
  createDomain: (data) => fetch(`${baseUrl}/domains`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  getDomain: (id) => fetch(`${baseUrl}/domains/${id}`).then(r => r.json()),
  updateDomain: (id, data) => fetch(`${baseUrl}/domains/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  deleteDomain: (id) => fetch(`${baseUrl}/domains/${id}`, { method: 'DELETE' }),
  testDomain: (domain) => fetch(`${baseUrl}/domains/match/${domain}`).then(r => r.json()),

  // Service Workers
  getSwStatus: () => fetch(`${baseUrl}/sw/remote/status`).then(r => r.json()),
};
```

## Navigation

Consistent sidebar/header navigation across all pages:
- Logo + "Revamp Admin"
- Dashboard link
- Domain Profiles link
- Configuration link
- Service Workers link
- External links:
  - Metrics Dashboard (original)
  - PAC Files
  - GitHub repo

## Responsive Design

- Desktop: Sidebar navigation, multi-column layouts
- Tablet: Collapsible sidebar, 2-column grids
- Mobile: Bottom navigation or hamburger menu, single column

## Error Handling

- Toast notifications for success/error messages
- Loading states for async operations
- Graceful degradation if API unavailable
- Form validation with inline errors

## Security Considerations

- Admin panel served only through proxy (requires proxy connection)
- No authentication in v1 (proxy access = admin access)
- Future: Add optional authentication layer
- CORS already configured in API

## Browser Support

Target: Same as proxy targets (Safari 9+, iOS 9+)
- Use ES5-compatible JavaScript
- Avoid modern CSS features without fallbacks
- Test on legacy WebKit

## Performance

- Minimal JavaScript (no framework overhead)
- CSS-only animations where possible
- Lazy load non-critical resources
- Cache static assets aggressively

## Future Enhancements (Out of Scope for v1)

- [ ] Authentication/login system
- [ ] Multiple user roles
- [ ] Audit logging
- [ ] Profile import/export
- [ ] Batch operations via CSV
- [ ] Real-time WebSocket updates
- [ ] Dark/light theme toggle
- [ ] Localization support
