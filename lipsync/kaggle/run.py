# Kaggle GPU job: re-animates mouths with LatentSync 1.5 (8 GB VRAM, fits the free T4).
# Input dataset: jobs.json [{"shotId", "video", "audio"}] plus the files it names.
# Output: /kaggle/working/<shotId>.mp4 and results.json.
import glob, json, os, subprocess, time

LATENTSYNC_COMMIT = "a229c3948406bc2cf6eaf4873e662e70c6a04746"
REPO = "/kaggle/temp/LatentSync"
OUT = "/kaggle/working"


def sh(cmd, cwd=None):
    print("+", cmd, flush=True)
    subprocess.run(cmd, shell=True, check=True, cwd=cwd)


jobs_path = glob.glob("/kaggle/input/**/jobs.json", recursive=True)[0]
base = os.path.dirname(jobs_path)
jobs = json.load(open(jobs_path))

sh(f"git clone -q https://github.com/bytedance/LatentSync.git {REPO} && git -C {REPO} checkout -q {LATENTSYNC_COMMIT}")
# Kaggle's Python (3.13) is too new for LatentSync's pins, so run it in its own 3.10 env.
VENV = "/kaggle/temp/venv"
PY = f"{VENV}/bin/python"
sh(f"pip install -q uv && uv venv -q -p 3.10 {VENV}")
sh(f"grep -v '^gradio' {REPO}/requirements.txt > /kaggle/temp/req.txt && uv pip install -q -p {PY} --index-strategy unsafe-best-match -r /kaggle/temp/req.txt")
sh(f"{VENV}/bin/huggingface-cli download ByteDance/LatentSync-1.5 latentsync_unet.pt whisper/tiny.pt --local-dir {REPO}/checkpoints")

results = []
for job in jobs:
    out = f"{OUT}/{job['shotId']}.mp4"
    started = time.time()
    try:
        sh(
            f"{PY} -m scripts.inference --unet_config_path configs/unet/stage2.yaml "
            "--inference_ckpt_path checkpoints/latentsync_unet.pt --inference_steps 20 --guidance_scale 1.5 "
            f"--enable_deepcache --video_path {base}/{job['video']} --audio_path {base}/{job['audio']} --video_out_path {out}",
            cwd=REPO,
        )
        results.append({"shotId": job["shotId"], "ok": True, "seconds": round(time.time() - started)})
    except subprocess.CalledProcessError as error:
        results.append({"shotId": job["shotId"], "ok": False, "error": str(error), "seconds": round(time.time() - started)})

json.dump(results, open(f"{OUT}/results.json", "w"), indent=2)
print(json.dumps(results, indent=2))
