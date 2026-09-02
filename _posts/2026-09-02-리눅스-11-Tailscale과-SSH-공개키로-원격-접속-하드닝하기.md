---
layout: post
title: "리눅스 (11) - Tailscale로 Mac에서 Windows VM에 SSH 접속하기"
date: 2026-09-02 16:31:20 +0900
categories: ["리눅스"]
tags: ["리눅스", "tailscale", "ssh", "public-key", "security", "ubuntu", "macos", "virtualbox", "가상머신"]
---

앞 글에서 Windows 노트북의 VirtualBox에 있는 복제 VM의 MAC 주소·고정 IP를 정리하고, Windows 호스트의 `127.0.0.1` 포트를 VM의 SSH 포트로 전달했다. 이 포트 포워딩은 **Windows 노트북에서** VM을 처음 설정하거나 문제가 생겼을 때 복구하는 데 유용하지만, Mac에서는 이 로컬 주소로 접근할 수 없다.

이번 글에서는 Mac과 Ubuntu VM을 같은 Tailscale 네트워크(tailnet)에 연결하고, Mac 터미널에서 VM의 Tailscale 이름으로 SSH에 접속한다. 최종 경로는 공개 인터넷에 SSH 포트를 열거나 VirtualBox 포트 포워딩을 거치지 않는다. SSH 인증은 기존 OpenSSH의 공개키 인증을 사용한다.

앞 글에서 복제 VM의 네트워크와 OpenSSH 서버가 준비됐다고 가정한다.

---

## 1. Windows의 포트 포워딩과 Mac의 Tailscale 접속 경로

10번 글의 NAT Network 포트 포워딩은 VM을 실행하는 **Windows 노트북에서만** 쓰는 로컬 경로다. 반면 Tailscale은 Mac과 VM이 각각 tailnet에 연결된 뒤, 두 장치 사이에 암호화된 사설 네트워크 경로를 만든다.

```text
초기 설정·복구 경로
Windows 노트북 ── ssh -p 2226 user@127.0.0.1 ──→ VirtualBox NAT Network ──→ Ubuntu VM :22

최종 SSH 접속 경로
Mac의 Tailscale + Terminal ──→ tailnet ──→ VM의 Tailscale ──→ OpenSSH :22
                                      └─ ssh user@nfsserver
```

| 구분 | 10번 글의 포트 포워딩 | 이 글의 Tailscale 경로 |
| --- | --- | --- |
| 접속 명령 예시 | `ssh -p 2226 user@127.0.0.1` | `ssh user@nfsserver` |
| 실행 위치 | VM을 실행하는 Windows 노트북 | 원격 클라이언트인 Mac |
| 주된 용도 | Windows에서의 최초 설정·로컬 복구 | Mac에서 VM으로 일상적인 SSH 접속 |
| VirtualBox 호스트 포트 | 필요 | 최종 접속에는 불필요 |
| 공인 IP·공유기 포트 개방 | 불필요 | 불필요 |

VM이 NAT Network에 있더라도 Tailscale 클라이언트가 바깥으로 연결할 수 있으면 된다. 이 구성에서 Tailscale을 설치할 장치는 **Mac과 Ubuntu VM**이며, Windows 노트북 자체에는 VM SSH 접속을 위해 Tailscale을 설치할 필요가 없다. 따라서 Mac에서 Tailscale 경로로 SSH할 때는 VM의 `192.168.56.12` 같은 NAT Network 고정 IP나 Windows의 `2226` 포트를 입력하지 않는다.

이 글에서는 Tailscale의 별도 SSH 서버 기능인 **Tailscale SSH**를 켜지 않는다. Tailscale은 VM까지 가는 네트워크 경로를 제공하고, VM에 이미 설치한 OpenSSH가 `authorized_keys` 공개키로 사용자를 인증한다.

---

## 2. Mac을 Tailscale에 연결하기

Mac에는 [Tailscale macOS 설치 문서](https://tailscale.com/docs/install/mac)의 앱을 설치한 뒤, 메뉴 막대의 Tailscale 아이콘에서 로그인한다. VM과 Mac은 반드시 **같은 계정의 tailnet**에 연결해야 한다.

연결이 끝나면 메뉴 막대에서 Tailscale이 연결 상태인지 확인한다. Mac에서는 이후에도 일반 `ssh` 명령을 그대로 사용한다. Tailscale 앱이 네트워크 경로와 DNS를 처리하므로, 별도의 VPN IP를 SSH 옵션에 지정할 필요가 없다.

---

## 3. Ubuntu VM을 Tailscale에 연결하기

Windows 노트북의 VirtualBox 콘솔 또는 10번 글에서 만든 로컬 포트 포워딩 SSH 세션으로 Ubuntu VM에 접속한다. Ubuntu에서 Tailscale을 설치하는 방법은 배포판 버전에 따라 달라질 수 있으므로 [Tailscale 공식 Linux 설치 문서](https://tailscale.com/docs/install/linux)를 기준으로 한다.

일반적인 Ubuntu 환경에서는 다음 명령으로 설치한 뒤, VM을 알아보기 쉬운 이름인 `nfsserver`로 tailnet에 연결할 수 있다.

```bash
# Ubuntu VM에서 실행
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname nfsserver
```

`tailscale up`을 실행하면 인증 URL이 출력된다. Mac의 브라우저에서 URL을 열어 로그인·승인하면 VM이 tailnet에 추가된다. 연결 후 VM에서 이름과 Tailscale IP를 확인한다.

```bash
# Ubuntu VM에서 실행
tailscale status
tailscale ip -4
```

tailnet 관리 화면이나 `tailscale status`에서 Mac과 `nfsserver`가 모두 온라인인지 확인한다. Tailscale IP는 접속 문제를 확인할 때 쓸 수 있지만, MagicDNS를 사용하면 평소에는 VM 이름만으로 접속할 수 있다.

### 원본 VM을 복제했다면 Tailscale 신원도 분리한다

원본 VM이 이미 Tailscale에 연결된 상태에서 복제했다면, 복제본에는 원본의 Tailscale 상태가 남아 있을 수 있다. **복제본 VM에서만** 아래 명령으로 로그아웃한 뒤, 복제본 이름으로 다시 인증한다.

```bash
# 복제본 Ubuntu VM에서 실행
sudo tailscale logout
sudo tailscale up --hostname nfsserver
```

새로 출력되는 인증 URL을 승인한다. 원본과 복제본은 서로 다른 장치 이름과 Tailscale IP를 가져야 한다. 이 작업을 하지 않으면 두 VM이 같은 Tailscale 장치 신원을 공유해 접속 대상이 혼란스러울 수 있다.

---

## 4. Mac의 공개키를 VM OpenSSH에 등록하기

Mac에 사용할 SSH 키가 없다면 Ed25519 키를 만든다. 이미 Mac에서 사용하는 키가 있다면 새로 만들지 않고 기존 키를 사용해도 된다.

```bash
# Mac에서 실행
ssh-keygen -t ed25519 -C "mac-client"
```

Mac의 공개키를 클립보드로 복사한다. 개인키인 `id_ed25519`가 아니라 `.pub` 확장자가 붙은 공개키만 등록해야 한다.

```bash
# Mac에서 실행
pbcopy < ~/.ssh/id_ed25519.pub
```

VM이 tailnet에 연결됐다면, Mac에서 먼저 기존 비밀번호 인증으로 VM에 접속한다. 이 터미널에서 `vim`을 열면 Mac 클립보드의 공개키를 그대로 붙여 넣을 수 있다.

```bash
# Mac에서 실행
ssh etakyung@nfsserver
```

VM에서 디렉터리와 파일의 권한을 설정하고 파일을 연다.

```bash
# Ubuntu VM에서 실행
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
vim ~/.ssh/authorized_keys
```

파일의 마지막 줄에 Mac에서 복사한 공개키를 붙여 넣고 저장한다. `authorized_keys`에는 키 하나당 한 줄을 사용하며, 키 문자열 중간에 줄바꿈이 들어가면 안 된다.

---

## 5. Mac에서 Tailscale 이름으로 SSH 접속하기

MagicDNS가 활성화된 tailnet이라면 장치 이름만으로 접속할 수 있다. 공개키만 사용하도록 강제해 먼저 확인한다.

```bash
# Mac에서 실행
ssh -i ~/.ssh/id_ed25519 \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  etakyung@nfsserver
```

짧은 이름이 해석되지 않으면 VM에서 확인한 Tailscale IP 또는 Tailscale 관리 화면에 표시되는 전체 도메인 이름을 사용한다.

```bash
# Mac에서 실행
ssh etakyung@100.x.y.z
ssh etakyung@nfsserver.<tailnet-name>.ts.net
```

매번 사용자 이름과 키 파일을 입력하지 않도록 Mac의 `~/.ssh/config`에 별칭을 만든다.

```text
Host nfsserver
  HostName nfsserver
  User etakyung
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

이제 Mac 터미널에서는 다음 한 줄로 VM에 접속한다.

```bash
ssh nfsserver
```

MagicDNS는 tailnet 장치 이름을 DNS 이름으로 사용할 수 있게 해 준다. 이름 접속이 잘 되지 않을 때는 Tailscale 관리 화면에서 MagicDNS가 활성화돼 있는지와 VM 이름이 `nfsserver`인지 확인한다.

---

## 6. 키 접속을 확인한 뒤 비밀번호 로그인 차단하기

`ssh nfsserver`가 새 Mac 터미널에서 성공한 것을 확인하기 전에는 비밀번호 로그인을 차단하지 않는다. 설정하는 동안에는 기존 SSH 세션이나 VM 콘솔을 유지해 두면, 설정 오류가 나도 바로 복구할 수 있다.

Ubuntu에서는 `/etc/ssh/sshd_config.d/50-cloud-init.conf`처럼 메인 설정 파일보다 먼저 읽히는 파일이 비밀번호 인증 값을 정할 수 있다. 따라서 먼저 읽히는 이름의 드롭인 파일을 만들고 실제 적용값을 확인한다.

```text
# /etc/ssh/sshd_config.d/00-hardening.conf
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
```

파일을 저장한 뒤 문법과 최종 설정값을 검증하고, 문제가 없을 때만 SSH 서비스를 다시 읽힌다.

```bash
# Ubuntu VM에서 실행
sudo chmod 600 /etc/ssh/sshd_config.d/00-hardening.conf
sudo sshd -t
sudo sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|permitrootlogin'
sudo systemctl reload ssh
```

`sshd -T` 출력에 다음 값이 보이면 키 인증 설정이 적용된 것이다.

```text
passwordauthentication no
kbdinteractiveauthentication no
pubkeyauthentication yes
```

Mac의 새 터미널에서 키 인증과 비밀번호 전용 로그인을 각각 확인한다.

```bash
# 성공해야 한다.
ssh nfsserver

# Permission denied가 나와야 한다.
ssh -o PreferredAuthentications=password \
  -o PubkeyAuthentication=no \
  etakyung@nfsserver
```

---

## 7. 접속이 안 될 때 확인할 항목

| 증상 | 먼저 확인할 내용 |
| --- | --- |
| `nfsserver` 이름을 찾지 못함 | Mac과 VM이 같은 tailnet에 연결됐는지, MagicDNS가 활성화됐는지, VM 이름이 맞는지 확인 |
| 연결 시간이 초과됨 | VM에서 `tailscale status`를 실행해 온라인 상태인지 확인. Mac의 Tailscale 접속에는 Windows의 `2226` 포트 포워딩이 필요하지 않음 |
| `Permission denied (publickey)` | VM의 `~/.ssh/authorized_keys`에 공개키 한 줄이 온전히 있는지와 `~/.ssh`는 `700`, `authorized_keys`는 `600`인지 확인 |
| SSH 설정 뒤 접속 불가 | 유지 중인 기존 SSH 세션 또는 VM 콘솔에서 `sudo sshd -t`를 다시 실행하고 `00-hardening.conf`를 수정 |

Tailscale 연결 자체는 정상이지만 OpenSSH 연결만 실패한다면, VM에서 아래 명령으로 SSH 서버가 실행 중인지와 22번 포트를 듣고 있는지도 확인한다.

```bash
sudo systemctl status ssh
sudo ss -tlnp | grep ':22'
```

---

## 8. 정리

10번 글의 NAT Network 고정 IP와 `127.0.0.1` 포트 포워딩은 Windows 노트북에서 복제 VM을 처음 구성하거나 로컬에서 복구할 때 쓸 수 있다. 하지만 Mac에서 Windows 노트북의 VM을 평소에 SSH로 관리하는 최종 경로는 Tailscale 이름을 사용하는 편이 더 단순하다.

Mac과 VM을 같은 tailnet에 연결하고, VM의 OpenSSH에 Mac 공개키를 등록하면 `ssh nfsserver`만으로 접속할 수 있다. 이때 Tailscale은 안전한 네트워크 경로를, OpenSSH 공개키는 로그인 인증을 담당한다. 키 접속을 새 터미널에서 검증한 후에만 비밀번호 로그인을 차단한다.

Tailscale로 기존 OpenSSH 서버에 접속하는 기본 방식은 [Tailscale SSH over Tailscale 문서](https://tailscale.com/docs/reference/ssh-over-tailscale), MagicDNS 설정은 [MagicDNS 문서](https://tailscale.com/docs/features/magicdns)에서 확인할 수 있다.
