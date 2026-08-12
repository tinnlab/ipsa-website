function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function interpolate(value, min, max, colorAtMin, colorAtMax) {
    const mid = (min + max) / 2;
    let color1, color2, factor;

    if (value <= mid) {
        color1 = hexToRgb(colorAtMin);
        color2 = hexToRgb('#FFFFFF'); // White
        factor = (value - min) / (mid - min);
    } else {
        color1 = hexToRgb('#FFFFFF'); // White
        color2 = hexToRgb(colorAtMax);
        factor = (value - mid) / (max - mid);
    }

    const r = Math.round(color1.r + factor * (color2.r - color1.r));
    const g = Math.round(color1.g + factor * (color2.g - color1.g));
    const b = Math.round(color1.b + factor * (color2.b - color1.b));

    return rgbToHex(r, g, b);
}

export default {
    interpolate
}
