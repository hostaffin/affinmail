#!/usr/bin/env python3
"""
Fast numpy-accelerated AffinMail Sovereign Wing logo PNG generator.
Produces crisp 512x512 and 1024x1024 PNG logo files.
"""
from PIL import Image, ImageDraw
import numpy as np
import math
import os

def draw_gradient_polygon(size, points, color_start, color_end, angle_deg=45):
    W, H = size
    # 1. Polygon Mask
    mask_img = Image.new('L', size, 0)
    draw_mask = ImageDraw.Draw(mask_img)
    draw_mask.polygon(points, fill=255)
    mask = np.array(mask_img, dtype=np.uint8)

    # 2. Gradient mesh grid
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(1.0, max_x - min_x)
    span_y = max(1.0, max_y - min_y)

    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)

    # Coordinate grids
    y_grid, x_grid = np.ogrid[:H, :W]
    norm_x = (x_grid - min_x) / span_x
    norm_y = (y_grid - min_y) / span_y
    t = np.clip(norm_x * cos_a + norm_y * sin_a, 0.0, 1.0)

    # Color interpolation
    c_start = np.array(color_start, dtype=np.float32)
    c_end = np.array(color_end, dtype=np.float32)
    
    # Broadcast (H, W, 4)
    rgb = (c_start + (c_end - c_start) * t[..., np.newaxis]).astype(np.uint8)
    
    # Apply alpha from mask
    alpha = (mask / 255.0 * (c_start[3] if len(c_start) > 3 else 255)).astype(np.uint8)
    rgba = np.dstack((rgb[..., :3], alpha))

    return Image.fromarray(rgba, 'RGBA')

def generate_logo_mark(output_path, target_size=1024):
    scale = 2  # 2x supersampling for speed & super-sharpness
    W = target_size * scale
    H = target_size * scale
    
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    
    # Margins and squircle geometry
    margin = int(W * 0.0625) # 4/64
    corner_radius = int(W * 0.25) # 16/64
    
    # Dark Enterprise Slate Squircle Background
    bg_box = [margin, margin, W - margin, H - margin]
    draw.rounded_rectangle(bg_box, radius=corner_radius, fill=(15, 23, 42, 255), outline=(51, 65, 85, 140), width=int(2 * scale * 4))
    
    def pt(x, y):
        return (x * (W / 64.0), y * (H / 64.0))
    
    # 1. Base "A" Pillars: M32 9L13 47C12.3 48.5 13.4 50 15 50H22.5C23.6 50 24.6 49.3 25.1 48.3L32 34L38.9 48.3C39.4 49.3 40.4 50 41.5 50H49C50.6 50 51.7 48.5 51 47L32 9Z
    pts_base = [
        pt(32, 9), pt(13, 47), pt(15, 50), pt(22.5, 50),
        pt(25.1, 48.3), pt(32, 34), pt(38.9, 48.3),
        pt(41.5, 50), pt(49, 50), pt(51, 47)
    ]
    p1 = draw_gradient_polygon((W, H), pts_base, (37, 99, 235), (30, 64, 175), angle_deg=65)
    canvas.alpha_composite(p1)
    
    # 2. Folded Envelope Flap: M32 9L15 42C14.2 43.6 15.6 45 17.2 44.5L32 39L46.8 44.5C48.4 45 49.8 43.6 49 42L32 9Z
    pts_fold = [
        pt(32, 9), pt(15, 42), pt(17.2, 44.5), pt(32, 39),
        pt(46.8, 44.5), pt(49, 42)
    ]
    p2 = draw_gradient_polygon((W, H), pts_fold, (96, 165, 250), (29, 78, 216), angle_deg=50)
    canvas.alpha_composite(p2)
    
    # 3. Central Mail Flight Flap: M32 16L21 34.5C20.5 35.4 21.2 36.5 22.3 36.5H41.7C42.8 36.5 43.5 35.4 43 34.5L32 16Z
    pts_accent = [
        pt(32, 16), pt(21, 34.5), pt(22.3, 36.5), pt(41.7, 36.5), pt(43, 34.5)
    ]
    p3 = draw_gradient_polygon((W, H), pts_accent, (6, 182, 212), (59, 130, 246), angle_deg=30)
    canvas.alpha_composite(p3)
    
    # 4. Modern Negative Space Aperture
    pts_aperture = [pt(32, 23.5), pt(26, 33.5), pt(38, 33.5)]
    draw = ImageDraw.Draw(canvas)
    draw.polygon(pts_aperture, fill=(15, 23, 42, 255))
    
    # 5. Fast Aero Wing Stroke / Envelope Crest Highlight
    draw.line([pt(32, 9), pt(21.5, 30)], fill=(255, 255, 255, 120), width=int(1.8 * scale * (W / 64.0) * 0.5))
    draw.line([pt(32, 9), pt(42.5, 30)], fill=(255, 255, 255, 120), width=int(1.8 * scale * (W / 64.0) * 0.5))
    
    # 6. Dynamic Cryptographic Seal / Speed Dot
    center = pt(32, 38)
    radius = 2.2 * (W / 64.0)
    draw.ellipse([center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius], fill=(45, 212, 191, 255))
    
    # Resize down with Lanczos
    final_img = canvas.resize((target_size, target_size), Image.Resampling.LANCZOS)
    final_img.save(output_path, 'PNG', optimize=True)
    print(f"Generated {output_path} ({target_size}x{target_size})")

if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'webmail', 'public')
    os.makedirs(out_dir, exist_ok=True)
    generate_logo_mark(os.path.join(out_dir, 'logo-mark.png'), 512)
    generate_logo_mark(os.path.join(out_dir, 'logo-mark-1024.png'), 1024)
    print("All PNG logo marks generated successfully!")
