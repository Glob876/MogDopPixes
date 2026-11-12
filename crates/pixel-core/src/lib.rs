//! Raster algorithms shared by the browser and Electron through WebAssembly.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn line_points(mut x0: i32, mut y0: i32, x1: i32, y1: i32) -> Vec<i32> {
    if [x0, y0, x1, y1]
        .iter()
        .any(|value| value.unsigned_abs() > 32768)
    {
        return Vec::new();
    }
    let mut points = Vec::new();
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut error = dx + dy;
    loop {
        points.extend([x0, y0]);
        if x0 == x1 && y0 == y1 {
            break;
        }
        let doubled = 2 * error;
        if doubled >= dy {
            error += dy;
            x0 += sx;
        }
        if doubled <= dx {
            error += dx;
            y0 += sy;
        }
    }
    points
}

fn valid_size(width: u32, height: u32, length: usize) -> bool {
    width > 0
        && height > 0
        && width <= 4096
        && height <= 4096
        && width as usize * height as usize * 4 == length
}

#[wasm_bindgen]
pub fn flood_mask(data: &[u8], width: u32, height: u32, x: i32, y: i32, tolerance: u8) -> Vec<u8> {
    if !valid_size(width, height, data.len())
        || x < 0
        || y < 0
        || x >= width as i32
        || y >= height as i32
    {
        return Vec::new();
    }
    let count = (width * height) as usize;
    let start = (y as u32 * width + x as u32) as usize;
    let target = &data[start * 4..start * 4 + 4];
    let mut mask = vec![0; count];
    let mut visited = vec![false; count];
    let mut stack = vec![start];
    visited[start] = true;
    while let Some(index) = stack.pop() {
        let pixel = &data[index * 4..index * 4 + 4];
        let matches = if pixel[3] == 0 && target[3] == 0 {
            true
        } else {
            pixel
                .iter()
                .zip(target)
                .all(|(a, b)| a.abs_diff(*b) <= tolerance)
        };
        if !matches {
            continue;
        }
        mask[index] = 1;
        let px = index % width as usize;
        let py = index / width as usize;
        let mut add = |next: usize| {
            if !visited[next] {
                visited[next] = true;
                stack.push(next);
            }
        };
        if px > 0 {
            add(index - 1);
        }
        if px + 1 < width as usize {
            add(index + 1);
        }
        if py > 0 {
            add(index - width as usize);
        }
        if py + 1 < height as usize {
            add(index + width as usize);
        }
    }
    mask
}

/// Modes: 0 horizontal flip, 1 vertical flip, 2 clockwise quarter turn.
#[wasm_bindgen]
pub fn transform(data: &[u8], width: u32, height: u32, mode: u8) -> Vec<u8> {
    if !valid_size(width, height, data.len()) || mode > 2 {
        return Vec::new();
    }
    let mut output = vec![0; data.len()];
    for y in 0..height {
        for x in 0..width {
            let (nx, ny, new_width) = match mode {
                0 => (width - 1 - x, y, width),
                1 => (x, height - 1 - y, width),
                _ => (height - 1 - y, x, height),
            };
            let source = ((y * width + x) * 4) as usize;
            let destination = ((ny * new_width + nx) * 4) as usize;
            output[destination..destination + 4].copy_from_slice(&data[source..source + 4]);
        }
    }
    output
}

#[wasm_bindgen]
pub fn resize_nearest(
    data: &[u8],
    width: u32,
    height: u32,
    new_width: u32,
    new_height: u32,
) -> Vec<u8> {
    if !valid_size(width, height, data.len())
        || new_width == 0
        || new_height == 0
        || new_width > 4096
        || new_height > 4096
    {
        return Vec::new();
    }
    let mut output = vec![0; (new_width * new_height * 4) as usize];
    for y in 0..new_height {
        for x in 0..new_width {
            let sx = x * width / new_width;
            let sy = y * height / new_height;
            let source = ((sy * width + sx) * 4) as usize;
            let destination = ((y * new_width + x) * 4) as usize;
            output[destination..destination + 4].copy_from_slice(&data[source..source + 4]);
        }
    }
    output
}

/// Remap RGB channels to the nearest supplied palette; preserve alpha.
#[wasm_bindgen]
pub fn apply_palette(data: &[u8], palette: &[u8]) -> Vec<u8> {
    if palette.len() < 3 || palette.len() % 3 != 0 {
        return data.to_vec();
    }
    let mut output = data.to_vec();
    for pixel in output.chunks_exact_mut(4) {
        if pixel[3] == 0 {
            continue;
        }
        let mut distance = u32::MAX;
        let mut nearest = &palette[0..3];
        for color in palette.chunks_exact(3) {
            let current: u32 = (0..3)
                .map(|channel| {
                    let difference = pixel[channel] as i32 - color[channel] as i32;
                    (difference * difference) as u32
                })
                .sum();
            if current < distance {
                distance = current;
                nearest = color;
            }
        }
        pixel[..3].copy_from_slice(nearest);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_contains_endpoints_in_both_directions() {
        let forward = line_points(0, 0, 3, 2);
        let mut reverse: Vec<_> = line_points(3, 2, 0, 0)
            .chunks_exact(2)
            .map(|p| [p[0], p[1]])
            .collect();
        reverse.reverse();
        assert_eq!(forward, reverse.concat());
        assert_eq!(&forward[..2], &[0, 0]);
        assert_eq!(&forward[forward.len() - 2..], &[3, 2]);
    }

    #[test]
    fn flood_does_not_cross_diagonal_or_opaque_barrier() {
        let data = [0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0];
        assert_eq!(flood_mask(&data, 2, 2, 0, 0, 0), vec![1, 0, 0, 0]);
        assert!(flood_mask(&data, 2, 2, -1, 0, 0).is_empty());
    }

    #[test]
    fn rectangular_rotation_and_four_turns_preserve_pixels() {
        let data: Vec<u8> = (0..24).collect();
        let mut output = data.clone();
        let (mut w, mut h) = (3, 2);
        for _ in 0..4 {
            output = transform(&output, w, h, 2);
            (w, h) = (h, w);
        }
        assert_eq!(output, data);
        assert_eq!(
            resize_nearest(&[1, 2, 3, 4], 1, 1, 2, 2),
            [1, 2, 3, 4].repeat(4)
        );
    }

    #[test]
    fn palette_mapping_preserves_transparency() {
        assert_eq!(
            apply_palette(&[240, 10, 10, 128, 80, 0, 0, 0], &[255, 0, 0]),
            vec![255, 0, 0, 128, 80, 0, 0, 0]
        );
    }
}
