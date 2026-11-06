# Changing the mechanic and bike photos

The photos shown on the home page are easy to replace in `src/assets/`:

- `palluh.png` is the mechanic portrait.
- `bike-photo.jpg` is currently used for all four bike build tiles. Replacing this file updates all four copies.
- `shimano.jpg` and `sramcert.jpg` are the certificate pictures currently wired to those credentials.

## Add a different bike photo

1. Copy the image into `src/assets/`, for example `build-wheel.jpg`.
2. Open `src/data/mechanic.js` and add an import at the top:

   ```js
   import wheelBuild from '../assets/build-wheel.jpg'
   ```

3. Add an entry to `MECHANIC.bikeBuilds`:

   ```js
   { src: wheelBuild, alt: 'Hand-built wheelset', caption: 'Wheel build' }
   ```

The grid adjusts its columns automatically. Images use `object-fit: cover`, so
they fill equal size tiles even when their original dimensions differ.

## Change or add certificate pictures

- For Shimano and SRAM, replace `src/assets/shimano.jpg` or `src/assets/sramcert.jpg` with the new scan, keeping the same filename.
- Campagnolo and Trek use `public/images/certificates/campagnolo.jpg` and `public/images/certificates/trek.jpg`. Put the scan at that path to make its card clickable.
- To show another certification, add an item to `MECHANIC.certifications` in `src/data/mechanic.js` and add its image path to `CERTIFICATE_IMAGES` in `src/components/MechanicSection.jsx`.

After replacing imported files, restart the frontend dev server so Vite reloads them.
