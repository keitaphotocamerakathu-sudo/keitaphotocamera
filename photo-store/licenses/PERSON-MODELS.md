# Local clothing and appearance search

This optional image index finds similar clothing and visible body appearance in the selected event. It does not infer personality or verify a person's identity. Face matches remain first; appearance matches are labelled separately and do not receive an identity-confidence percentage. Only the body explicitly selected by the customer is queried.

## Pinned models

| File | Upstream | License | SHA-256 |
| --- | --- | --- | --- |
| `yolox_nano.onnx` | [Official YOLOX 0.1.1rc0 release](https://github.com/Megvii-BaseDetection/YOLOX/releases/tag/0.1.1rc0) | Apache-2.0, see `YOLOX-APACHE-2.0.txt` | `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d` |
| `osnet_x025_msmt17_v1.onnx` | [Torchreid OSNet model zoo](https://kaiyangzhou.github.io/deep-person-reid/MODEL_ZOO), x0.25 MSMT17 domain-generalization checkpoint | MIT, see `OSNET-MIT.txt` | `94b824185fb6597d1abb32ae646731b0c3b32807706a06935795fd8f0dd0f9ea` |

The OSNet checkpoint is linked by the upstream model zoo at Google Drive ID `1Kkx2zW89jq_NETu4u42CFZTMVD5Hwm6e`. Its original bytes were verified against that link: 9,336,983 bytes, SHA-256 `cf55163d78fc44c62c82f85ab62d39f10438679b5abe8c698ae08cfa84aa6e18`. The evaluation model is exported without its training classifier, with fixed input `[1,3,256,128]`, output `[1,512]`, and ONNX opset 17. The exported artifact is 891,051 bytes. YOLOX is 3,659,407 bytes. Both models are served from this repository and verified by size and digest before use.

## Preprocessing and index compatibility

- YOLOX: 416-square input, top-left letterbox with value 114, unnormalized BGR; decode grid/stride output, keep the person class, apply NMS.
- OSNet: 128 by 256 person crop, RGB divided by 255, ImageNet mean/std, L2-normalized 512-dimensional embedding.
- Clothing check: separate normalized 11-bin upper/lower color histograms, stored with the body box.
- Engine: `person-osnet-x025-v1`; sync version: `person-osnet-x025-v1-rgb-hist1`. Never compare with face vectors, including FaceX's 512-dimensional vectors.
- Inference: pinned ONNX Runtime Web 1.21.0, one WASM thread. No metered recognition API is added.

The production threshold is conservative and is not an accuracy guarantee. Similar outfits can still produce similar results; different outfits, severe occlusion, small people, and lighting changes can reduce recall. The supporting model is used only for still photos. Video face search retains its existing behavior.

## Validation, 2026-09-22

17 regression tests cover engine isolation, pagination, selected-person handling, cancellation, color validation, result labels, and save acknowledgements. A real three-person fixture was checked with the production JavaScript preprocessing and WASM models against native ONNX inference: cosine distances to the native references were below 0.005. Covering the main subject's head still matched that subject at distance 0.1605, with other subjects above 0.49. This is a focused regression check, not a representative accuracy benchmark.

The atomic save RPC was also checked in a rolled-back production transaction: complete save, preserve the prior index on an empty rescan, and preserve other face engines.
