"""
小狗AI · 狗叫音频生成脚本（pyttsx3 / 系统SAPI离线版）
用 Windows 自带神经网络语音（Microsoft Huihui）离线生成「汪」，
再重采样升调做出小奶狗音色。全程离线、零背景音、无限重跑。

用法：
  python tools/gen_barks.py
产物：public/barks/bark-XX.wav（前端随机播放）
"""

import os
import wave

import numpy as np
import pyttsx3

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "barks")
TMP_DIR = os.path.join(OUT_DIR, "_raw")
os.makedirs(TMP_DIR, exist_ok=True)

# (文件名, 文本, 升调倍数) —— 倍数越高越"奶"，1.0 = 原声
JOBS = [
    ("bark-01.wav", "汪！",       1.55),
    ("bark-02.wav", "汪汪！",     1.50),
    ("bark-03.wav", "汪汪汪！",   1.60),
    ("bark-04.wav", "汪！汪！",   1.45),
    ("bark-05.wav", "汪？",       1.55),
    ("bark-06.wav", "汪汪！汪！", 1.40),
]

VOICE_KEYWORD = "Huihui"  # 系统中文语音
RATE = 210                # SAPI 语速，默认 200 左右，稍快更活泼


def synth_raw() -> None:
    """SAPI 合成原始 WAV（女声原调）"""
    engine = pyttsx3.init()
    for v in engine.getProperty("voices"):
        if VOICE_KEYWORD.lower() in v.id.lower() or VOICE_KEYWORD.lower() in v.name.lower():
            engine.setProperty("voice", v.id)
            break
    engine.setProperty("rate", RATE)
    for name, text, _ in JOBS:
        engine.save_to_file(text, os.path.join(TMP_DIR, name))
    engine.runAndWait()
    engine.stop()


def pitch_shift(raw_path: str, out_path: str, factor: float) -> None:
    """重采样升调（速度同步变快，奶狗又尖又急的质感）+ 归一化"""
    with wave.open(raw_path, "rb") as r:
        rate = r.getframerate()
        nch = r.getnchannels()
        width = r.getsampwidth()
        frames = r.readframes(r.getnframes())
    assert width == 2, "只支持 16-bit PCM"
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if nch > 1:
        samples = samples.reshape(-1, nch).mean(axis=1)

    n = len(samples)
    new_n = int(n / factor)
    samples = np.interp(np.linspace(0, n - 1, new_n), np.arange(n), samples).astype(np.float32)

    peak = np.max(np.abs(samples)) or 1.0
    pcm16 = (samples / peak * 0.9 * 32767).astype(np.int16)
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm16.tobytes())


def main() -> None:
    synth_raw()
    for name, text, factor in JOBS:
        raw = os.path.join(TMP_DIR, name)
        out = os.path.join(OUT_DIR, name)
        pitch_shift(raw, out, factor)
        os.remove(raw)
        print(f"OK  {name}  <-  {text}  (升调x{factor})")
    os.rmdir(TMP_DIR)
    print(f"\n全部生成完毕 -> {os.path.abspath(OUT_DIR)}")


if __name__ == "__main__":
    main()
