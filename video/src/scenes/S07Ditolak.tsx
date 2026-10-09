import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Hand, ShieldAlert } from "lucide-react";
import { fadeUp, popIn, tween, useEnter } from "../components/anim";
import { ScreenClip } from "../components/ScreenClip";
import { alignClip, mark, MODAL_DELAY } from "../clipTiming";
import { C, fontFamily } from "../theme";
import { at } from "../timing";

const ID = "07-ditolak" as const;
// Area modal hasil di rekaman 1920×1080.
const MODAL = { x: 550, y: 305, w: 820 };

type Tile = { clip: string; mark: string; word: string; nth?: number; label: string; color: string };
const TILES: Tile[] = [
  { clip: "rejects", mark: "dup", word: "Merah", label: "Tiket sudah dipakai", color: C.warningLite },
  { clip: "rejects", mark: "notToday", word: "bukan", label: "Bukan penerbangan hari ini", color: C.dangerLite },
  { clip: "rejects", mark: "notActive", word: "belum", label: "Penerbangan belum aktif / ditutup", color: C.dangerLite },
  { clip: "rejects", mark: "unknown", word: "dikenal", label: "Kode penerbangan tidak dikenal", color: C.dangerLite },
  { clip: "rejects", mark: "invalid", word: "barcode", label: "Barcode tidak valid", color: C.dangerLite },
  { clip: "ktp", mark: "scan", word: "KTP", label: "Nama KTP ≠ boarding pass", color: C.dangerLite },
];
const TILE_W = 500;
const TILE_H = (TILE_W * 9) / 16;
const GAP_X = 40;
const ROW_Y = [182, 182 + TILE_H + 64];
const X0 = (1920 - (TILE_W * 3 + GAP_X * 2)) / 2;

const TileView: React.FC<{ tile: Tile; appear: number; index: number; dim: number }> = ({ tile, appear, index, dim }) => {
  const p = useEnter(appear, { damping: 13 });
  const frame = useCurrentFrame();
  if (frame < appear - 2) return null;
  const left = X0 + (index % 3) * (TILE_W + GAP_X);
  const top = ROW_Y[Math.floor(index / 3)];
  // Modal ditahan hampir diam (playbackRate kecil) selama sisa scene.
  const from = mark(tile.clip, tile.mark) + MODAL_DELAY + 0.6;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, opacity: Math.min(1, p * 1.6) * (1 - dim * 0.65), transform: `translateY(${(1 - p) * 40}px)` }}>
      <Sequence from={appear} layout="none">
        <ScreenClip clip={tile.clip} clipFrom={from} playbackRate={0.08} left={left} top={top} width={TILE_W} focus={[{ at: 0, ...MODAL }]} />
      </Sequence>
      <div style={{ position: "absolute", left, top: top + TILE_H + 16, width: TILE_W, textAlign: "center", fontFamily, fontSize: 24, fontWeight: 700, color: tile.color }}>
        {tile.label}
      </div>
    </div>
  );
};

/**
 * Duplikat & ditolak — modal asli: duplikat (kuning) besar dulu, lalu grid enam
 * modal penolakan yang muncul mengikuti narasi, ditutup instruksi S.O.P.
 */
export const S07Ditolak: React.FC = () => {
  const frame = useCurrentFrame();
  const gridAt = at(ID, "Merah") - 4;
  const holdAt = at(ID, "Tahan") - 4;
  const dim = tween(frame, [holdAt, holdAt + 10], [0, 1]);
  const banner = useEnter(holdAt, { damping: 12 });
  const sop = useEnter(at(ID, "eskalasi") - 4);
  const dupFrom = alignClip(mark("rejects", "dup") + MODAL_DELAY + 0.3, 8);
  return (
    <AbsoluteFill style={{ fontFamily }}>
      <Sequence durationInFrames={gridAt + 6} layout="none">
        <ScreenClip
          clip="rejects"
          clipFrom={dupFrom}
          focus={[{ at: 0, ...MODAL }]}
          highlights={[{ from: 10, to: gridAt, x: 690, y: 362, w: 250, h: 44, label: "Kuning = sudah pernah di-scan", color: C.warningLite }]}
        />
      </Sequence>
      {TILES.map((t, i) => (
        <TileView key={t.mark + t.clip} tile={t} index={i} appear={i === 0 ? gridAt : at(ID, t.word, t.nth) - 4} dim={dim} />
      ))}
      {frame >= holdAt - 2 ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 120 }}>
          <div
            style={{
              ...popIn(banner),
              display: "flex",
              alignItems: "center",
              gap: 30,
              padding: "34px 48px",
              borderRadius: 30,
              background: "linear-gradient(90deg, rgba(120,16,40,0.95), rgba(40,10,24,0.95))",
              border: `2px solid ${C.danger}`,
              boxShadow: `0 0 80px -10px rgba(244,63,94,0.8)`,
            }}
          >
            <div style={{ width: 100, height: 100, borderRadius: 28, background: C.danger, display: "flex", alignItems: "center", justifyContent: "center", transform: `rotate(${Math.sin(frame / 4) * 8}deg)` }}>
              <Hand size={60} color="white" />
            </div>
            <div style={{ color: C.text, fontSize: 54, fontWeight: 800 }}>Tahan penumpang</div>
            <div style={{ fontSize: 54, color: C.dangerLite, ...fadeUp(sop, 0) }}>➜</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, ...fadeUp(sop, 20) }}>
              <ShieldAlert size={54} color={C.dangerLite} />
              <div style={{ color: C.text, fontSize: 54, fontWeight: 800 }}>Eskalasi sesuai S.O.P</div>
            </div>
          </div>
        </AbsoluteFill>
      ) : null}
      <Sequence from={8} durationInFrames={16} layout="none">
        <Audio src={staticFile("audio/sfx-pop.wav")} volume={0.5} />
      </Sequence>
      {TILES.slice(1).map((t) => (
        <Sequence key={t.mark + t.clip} from={at(ID, t.word, t.nth) - 4} durationInFrames={16} layout="none">
          <Audio src={staticFile("audio/sfx-buzz.wav")} volume={0.16} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
