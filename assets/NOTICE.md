# Notice: where the game's art and sound come from

Everything the game ships must be free to sell. This file lists every asset that was not
made from nothing in this repository, and the licence of every model that made one.
Add a row before adding a file; an asset that is not listed here does not go in.

## Artwork from outside

None. No picture in `assets/sprites` was downloaded, traced or taken from another game or
artist. Free art from the internet (CC0 sets such as Kenney's) was considered for the units
and rejected: clean vector-shaded 3D would have been a third look beside the painted
buildings, and restyling it costs more than painting our own models (docs/art/STYLE.md).

If one is added later it needs: source address, author, licence (CC0, or CC-BY with the
credit written here), what was changed, and where it is used. Nothing "free for personal
use", nothing ripped from or imitating a particular game.

## Models that made the pictures

| Model | Used for | Licence | Source |
|---|---|---|---|
| FLUX.2 [klein] 4B, distilled | buildings, landmarks, ground, portraits; painting the unit sheets | Apache-2.0 | https://huggingface.co/black-forest-labs/FLUX.2-klein-4B |
| Qwen3 4B text encoder (fp4) | the same | Apache-2.0 | https://huggingface.co/Comfy-Org/Flux-2-Klein-4B |
| FLUX.2 VAE | the same | Apache-2.0 | https://huggingface.co/Comfy-Org/Flux-2-Klein-4B |
| BiRefNet (general) | cutting the background away | MIT | https://github.com/ZhengPeng7/BiRefNet |

The FLUX.2 klein 9B model is non-commercial and must not be used.

## Tools

Blender 4.2 (GPL) renders the unit models built in `art/units.py` and `art/props.py`; the
licence covers the program, not the pictures made with it. ComfyUI (GPL-3.0) runs the image
model; nothing of it ships.

## Details

Per-picture seeds and prompts: `assets/sprites/CREDITS.md`. The music is from outside: each
track, its author and its licence are in `assets/audio/CREDITS.md`.
