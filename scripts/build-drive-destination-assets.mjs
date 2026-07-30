// build-drive-destination-assets.mjs — emit data/releases/assets/drive-destination-photos.json
// from the shared "Destination Photos" Google Drive folder (public, anyone-with-link).
//
// Each image is served straight from Google's image CDN
// (https://lh3.googleusercontent.com/d/<fileId>=w<width>), which auto-resizes for the web,
// so nothing has to be re-hosted. Photos are grouped by destination and mapped to the
// matching CMS destination page via recommended_pages. build-seed.mjs merges this file with
// data/releases/assets/assets.json into the assets registry (→ /admin/media, editable swaps).
//
// Run manually (committed output, like build-asset-extract.mjs):  node scripts/build-drive-destination-assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const WIDTH = 1600; // display width Google's CDN renders (originals up to ~15MB; this keeps pages light)
const cdn = (id) => `https://lh3.googleusercontent.com/d/${id}=w${WIDTH}`;
const view = (id) => `https://drive.google.com/file/d/${id}/view`;

// Source: Google Drive → "Destination Photos" → <DEST> (owner hello@javavolcano-touroperator.com).
const DESTINATIONS = [
  {
    slug: 'mount-bromo', route: '/destinations/mount-bromo',
    label: 'Mount Bromo', alt: 'Mount Bromo volcanic landscape in East Java',
    ids: [
      '1h1d3Hx9VIQDhBgJxdynZV8z4RjOdy201', '15Bf6k_rREpUaGLu2FERsCupBnmEEwEtP',
      '1FeT_2fdVPvrvL8vEi8uoT1iLG6EVQBUo', '1KoPAy95Fjih97XhvDGuODfp-pcci6CtY',
      '1E2H9keCWF_9_EQqH8jKi92USVUgCFQSJ', '1T-ShteHRT3hq2Q-HaNOtC9iLPxO1M9yJ',
      '1ZzOp9_yM2tVCoF9snxwLm4qcJHiivZ3r', '1gcUtoqfQZ0rHQANsK9GkL-WKubwY7MBR',
      '1TLSRwu5JzrV928iyeeEZBtLwhT7jhLCM', '1iGxnHOrH8Pu9oCzPezvgUnVEvkl2IpI8',
      '11h8V9Ws2pYgjQ2o8Tcl2xVmMT_BIV8Tn', '14H0vClrosELvwmXkYFpYROzXnX7xXqoE',
      '1xXsiZCa6DZT7Y42I0gYUt9Fiys3Q9IrC',
    ],
  },
  {
    slug: 'ijen-crater', route: '/destinations/ijen-crater',
    label: 'Kawah Ijen', alt: 'Kawah Ijen crater and turquoise lake, East Java',
    ids: [
      '19le2Gtuk43X0SjoffYJu5QliQAfNgro5', '1hRVwjT-R1y3mTzAxOpWOK4-0DHy69W0p',
      '1mrkrdiyYhFECJlHmSduGMfNBxTTenrBh', '1Jo3eU8792lSaSQ1ks9kB1L_XwhJ-lG8p',
      '12GEaF8beHGaVb_VGp0bOjlw4-YANWYe7', '1ms11SBB3xRjWh7Wu2nqEbfMND4jRji4z',
      '1h4mXqpK-dt8smVPaeAO39SueZENbssxf', '1aoQ8R5I0yn7tE4J4j2-rm62hodLuJ9E_',
      '1WjBA6xBu_ODwc0yatiE1GsBrCR7G0bjl', '1Zr9cawHUXss3ZYtVZkGgaOx2iOLFc3r1',
      '1IUETPeLNIief-5bbnOPJzDJuKSH32iY_', '1HM9UyZHZqRVabUawhEytXVuExbmgptOU',
      '1A2uYtmj8UbiAWCPIIb0Tlkcqn7L_KDOf',
    ],
  },
  {
    slug: 'madakaripura-waterfall', route: '/destinations/madakaripura-waterfall',
    label: 'Madakaripura Waterfall', alt: 'Madakaripura Waterfall canyon, East Java',
    ids: [
      '16YR5YkpF5BgcSKshtGM5zMsEn02qYj8S', '16zXlSKGASc7WXSeNKIjGD7PFbr9zJ1Vt',
      '1_N7LwLdygwM4cI2fvJ-h_FzsTtC1LEus', '1ETOF595HRWeZT9V1G0_yRvvk9MmAScJb',
      '1bbEeghhbNnxGd81GaCZvsvqVrHhAdvIE', '1rdhHjNJQH-9Cl5259v_Lkp2pNKAOqbDx',
      '1yTEIcfxP_t8d8lCk5rC-hGRjDUO80q2N', '1_SKpcfaYmYVMRzJERlm4cDBtL81wdTxK',
      '1iEtLYY14LotVKXleW9DlEh-rPQd4_Lfm',
    ],
  },
  {
    slug: 'papuma-beach', route: '/destinations/papuma-beach',
    label: 'Papuma Beach', alt: 'Tanjung Papuma Beach coastline, East Java',
    ids: [
      '1HgnoOC77OyJxXU1qFudZJsDV_1fhah0z', '1CbdRmVauSNT94q9DW2QBTU0dc_RVYvlg',
      '1MIKcd2efRVnroAhkfMvrX7EdxPInZk11', '1jCRfODI2a-4sJdu4CPLbnXzpateGFrtQ',
      '1GKKczBUaq7lralxY-lXY89FPDbdpQ7QW', '1mj9uIeyzgtYHKVqp5ZvFsCkTyj31eerf',
      '1eGwmKSfYIwJtNxsAvXXiP4XZXYrAoC-k',
    ],
  },
  {
    slug: 'tumpak-sewu-waterfall', route: '/destinations/tumpak-sewu-waterfall',
    label: 'Tumpak Sewu Waterfall', alt: 'Tumpak Sewu Waterfall panorama, East Java',
    ids: [
      '1UmE5RrqLmxiKGz9kZ6TQTocrk6wuZfWN', '1KCg7kPj8-A4UBYBKFMjp9J2pf84fk-Sv',
      '1pGwbuptfO9mnwgkrYhzVhY_Ky4jdi2YQ', '1-FIVSTHt08barj8iDg65Bn0h2PcHQ0jx',
      '10LS_ZWUt1WG_f28yj6ieqgeuRxvuHyIw', '1z3R56wLdz_wiyDCGWEY1fKNao2QmoYJ5',
      '1oewhr9vX_uoZ6SkNDlAnT5DJx_RSvP41', '1ESmAckL2QRUjxPpL1d2ffe-o6ac-fL_4',
      '1_PqKOkOH_d-w5kNdS4lbO_WsaooPaUZJ', '19qntW3IrlmRskaVBHFR4DPPxcf9oQ1TP',
      '1ZSx0r576d71ke-EpwRGK2K6m5dYRVaYQ', '18PfH22W2PYJXKJ-uTUyTtollMIprOzhC',
      '1foNRKkh2F3xLI1JF6yPmyTmGhNhaRLBh', '1xaFo9CzHvR-qgJ1xpBodxxSIcCJzy2r6',
      '1O7zkesLvAD3i7cyNdK1ZujTYCwhh9O6s', '1uASBo1aor4-GNaJbFdDz3V_TRBiH-YWT',
      '1ierF4qdXfDhqB-pCivXDvFin8helih7p', '1B0j4EY0J9BPmDDP5m9XVD--AKcrbjNl3',
      '1l_et9K3VMVrsLLoIaOGoGO0Wa_wGDqGN', '1RbBtdD_dWwPCyxbEhUaldYwKzUV1uhuo',
      '1zt0pKVO39Rj6Q7DbR41JBBkrLCNMENXl', '17zXAJkrP_Wyj-RrbPCGWH1QclSHgBx0i',
      '1Chg2muRwtnXMTKpObUYZa7Xue3OBsNAj', '1_zUIKIgsBycbEGm2ZbgtwUOXzOJ5zsdC',
      '1jPoZxBYdW5xQvxD4_mgLoIpaydquxdMS', '1O8MQtDcFifcO7t6z1rxv57f-ABxJSL9t',
      '14usehkISdcJi92jH7l562er3X4aIKvjN', '1jlXAJ9RoHjlKxD2F8rHClxTextQbdtX5',
      '1wBVqEDu7fAeNhI2UdCHlY4gFABogihtX', '1fqoLcUTxz-YwSO5drvfUDBiRD9iA7B1d',
      '1vaiEILOeQVlIvB2ChaB5SYl4TmjyJ9nO', '1tV4j6Xk9aN49nUPL0ehuFdvGxkvK2to3',
    ],
  },
];

const rows = [];
for (const d of DESTINATIONS) {
  const seen = new Set();
  d.ids.forEach((id) => {
    if (seen.has(id)) return; // dedupe within a destination
    seen.add(id);
    const nn = String(seen.size).padStart(2, '0');
    rows.push({
      key: `destination-photo/${d.slug}/${nn}`,
      url: cdn(id),
      title: `${d.label} — photo ${nn}`,
      alt: d.alt,
      caption: null,
      kind: 'image',
      group: 'destination_photos',
      source_field: 'drive_destination_photos',
      source_category: 'google_drive',
      recommended_pages: [d.route],
      link: null, // gallery asset; not a jvto_dev field-attach mapping
      drive_file_id: id, // provenance (ignored by build-seed; used later for IG re-host)
    });
  });
}

const out = {
  generatedAt: '2026-07-30',
  source: 'google-drive:Destination Photos (anyone-with-link)',
  count: rows.length,
  rows,
};
const dest = path.join(process.cwd(), 'data/releases/assets/drive-destination-photos.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
const byDest = DESTINATIONS.map((d) => `${d.slug}=${new Set(d.ids).size}`).join(' ');
console.log(`drive-destination-photos.json: ${rows.length} rows (${byDest})`);
