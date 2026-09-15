---
layout: post
title: "Redis와 Memcached, 캐시 서버 선택하기"
date: 2026-09-14 09:02:43 +0900
categories: ["Backend"]
tags: ["cache", "redis", "memcached", "performance", "backend"]
---

## 1. 캐시는 원본 저장소 앞에 두는 빠른 복사본이다

상품 상세, 인기 게시글, 사용자 프로필처럼 자주 읽히지만 매번 바뀌지는 않는 데이터를 요청마다 데이터베이스에서 조회하면, 데이터베이스 연결과 디스크 I/O에 요청이 집중된다. **캐시(Cache)** 는 자주 쓰는 데이터를 메모리에 임시로 복사해 두고 더 빠르게 꺼내는 저장소다.

애플리케이션은 먼저 캐시를 조회한다. 값이 있으면 **캐시 히트(Cache Hit)** 로 바로 응답하고, 값이 없으면 **캐시 미스(Cache Miss)** 로 원본 저장소를 조회한 뒤 결과를 캐시에 넣는다. 이 방식은 데이터베이스 부하와 응답 시간을 줄여 주지만, 캐시의 값이 원본과 잠시 달라질 수 있다는 비용도 생긴다.

Redis와 Memcached는 모두 네트워크를 통해 사용하는 인메모리 키-값 저장소이며, 캐시 용도로 널리 쓰인다. 다만 Redis는 캐시 외의 기능까지 제공하는 데이터 플랫폼에 가깝고, Memcached는 단순하고 휘발성인 분산 캐시에 집중한다. 따라서 "어느 쪽이 더 빠른가"보다 **어떤 데이터와 장애 모델을 감당해야 하는가**를 기준으로 고르는 편이 좋다.

---

## 2. 먼저 캐시가 읽기 요청을 처리하는 흐름을 이해하자

가장 흔한 패턴은 애플리케이션이 캐시를 직접 제어하는 **캐시 어사이드(Cache-Aside)** 다. 예를 들어 `product:42`라는 키에 42번 상품 정보를 저장한다고 하자.

```text
1. 애플리케이션이 cache.get("product:42")를 호출한다.
2. 값이 있으면 그 값을 응답한다.                        → 캐시 히트
3. 값이 없으면 DB에서 상품 42를 조회한다.               → 캐시 미스
4. 조회 결과를 TTL과 함께 cache.set("product:42", ...) 한다.
5. DB에서 읽은 결과를 응답한다.
```

TTL(Time To Live)은 캐시 값이 자동으로 사라지는 시간이다. TTL을 두면 값이 영원히 남아 원본과 멀어지는 일을 줄일 수 있다. 반대로 너무 짧으면 캐시 미스가 많아져 캐시의 효과가 작아지고, 너무 길면 오래된 값을 더 오래 보여 줄 수 있다.

상품이 수정되면 캐시도 처리해야 한다. 일반적으로는 DB 변경이 성공한 뒤 해당 키를 삭제한다. 다음 조회가 최신 값을 DB에서 읽어 다시 채우므로, 이를 **캐시 무효화(Cache Invalidation)** 라고 한다.

```text
상품 수정 요청
  └─ DB의 상품 42 변경 성공
       └─ cache.delete("product:42")
            └─ 다음 읽기 요청이 최신 값으로 캐시를 다시 채움
```

캐시는 원본 데이터의 유일한 저장소가 아니다. Memcached의 값은 서버 재시작이나 메모리 부족으로 사라질 수 있고, Redis도 캐시로 쓰는 데이터는 만료·축출될 수 있다. 캐시가 비어 있어도 DB나 다른 원본에서 다시 복구할 수 있도록 설계해야 한다.

---

## 3. Redis는 자료 구조와 원자적 연산을 제공한다

Redis는 문자열뿐 아니라 Hash, List, Set, Sorted Set, Stream 같은 자료 구조를 서버 안에서 제공한다. 단순히 직렬화한 객체를 통째로 보관하는 캐시로도 쓸 수 있고, 자료 구조별 연산을 활용해 다른 문제를 해결할 수도 있다.

예를 들어 상품별 조회 수를 캐시에서 세는 경우, 애플리케이션이 값을 읽고 1을 더해 다시 저장하면 동시에 들어온 요청이 서로의 값을 덮어쓸 수 있다. Redis의 `INCR`은 증가 작업 자체가 원자적이므로 이 경쟁을 피할 수 있다.

```text
INCR product:42:view-count
EXPIRE product:42:view-count 86400
```

또한 Redis는 선택적으로 RDB 스냅샷 또는 AOF(Append Only File) 방식의 영속화를 설정할 수 있고, 복제, Sentinel, Cluster, Pub/Sub, Lua 스크립트 같은 기능도 제공한다. 이 기능들은 세션, 레이트 리밋(특정 사용자나 IP가 일정 시간 동안 보낼 수 있는 요청 수를 제한하는 것), 순위표, 분산 락처럼 캐시보다 넓은 요구사항에 유용하다.

하지만 영속화가 켜져 있다고 Redis를 관계형 데이터베이스와 같은 최종 저장소로 생각하면 안 된다. 영속화 방식과 설정에 따라 장애 직전의 쓰기가 남지 않을 수 있으며, 캐시를 위한 메모리 축출 정책도 데이터 보존 요구와 충돌할 수 있다. 중요한 업무 데이터의 최종 정합성은 여전히 데이터베이스나 그 목적에 맞는 저장소가 책임져야 한다.

---

## 4. Memcached는 단순한 분산 메모리 캐시에 집중한다

Memcached는 키와 바이트 값, 그리고 만료 시간을 저장하는 단순한 인메모리 캐시다. 서버는 값의 내부 구조를 해석하지 않는다. 애플리케이션이 객체를 JSON, 직렬화 바이트 등으로 바꿔 저장하고, 다시 읽어 복원한다.

```text
key:   product:42
value: {"id":42,"name":"키보드","price":99000}
TTL:   300초
```

Memcached는 기본적으로 데이터를 디스크에 영속화하거나 노드 간 복제를 제공하지 않는다. 여러 노드에 데이터를 나눠 저장할 때도 보통 클라이언트가 일관 해싱(Consistent Hashing)으로 어느 노드에 요청할지 결정한다. 노드가 바뀌면 일부 키의 위치가 달라져 캐시 미스가 늘 수 있지만, 캐시 데이터는 원본에서 다시 가져올 수 있으므로 이 단순함을 받아들이는 경우가 많다.

또한 Memcached는 여러 워커 스레드로 요청을 처리해 다중 CPU 코어를 활용한다. 값이 단순하고 읽기 비중이 매우 높으며, 캐시가 사라져도 원본에서 쉽게 재생성할 수 있는 환경에서는 운영 모델이 명확한 선택이 될 수 있다.

---

## 5. Redis와 Memcached의 차이

두 시스템 모두 메모리를 주 저장 공간으로 쓰므로, 캐시 용도에서는 네트워크 왕복 시간, 값 크기, 직렬화 비용, 키 분포, 애플리케이션 접근 패턴이 실제 성능을 크게 좌우한다. 특정 제품이 모든 상황에서 항상 더 빠르다고 단정하기보다, 서비스 트래픽과 데이터 크기로 부하 테스트를 해야 한다.

| 구분 | Redis | Memcached |
| --- | --- | --- |
| 기본 모델 | 키와 다양한 자료 구조를 제공하는 인메모리 데이터 저장소 | 키와 바이트 값에 집중한 단순 인메모리 캐시 |
| 데이터 처리 | Hash, Set, Sorted Set 등 자료 구조별 명령과 원자적 연산 사용 가능 | 값을 서버가 해석하지 않으며, 주로 조회·저장·삭제 수행 |
| 데이터 보존 | RDB/AOF 영속화를 선택적으로 설정할 수 있음 | 기본적으로 메모리에만 존재하며 재시작 시 사라짐 |
| 고가용성·확장 | 복제, Sentinel, Cluster 기능 제공 | 클라이언트 측 샤딩을 주로 사용하며 복제는 내장하지 않음 |
| 부가 기능 | Pub/Sub, Lua 스크립트, Stream, 트랜잭션 명령 등 | 캐시라는 핵심 역할에 집중 |
| 잘 맞는 경우 | 캐시와 함께 세션·카운터·순위·레이트 리밋 등 자료 구조 기능이 필요한 경우 | 단순 객체 캐시를 수평 확장하고, 데이터가 사라져도 쉽게 재생성되는 경우 |
| 주의점 | 기능이 많아 메모리 정책, 복제, 영속화 설정을 목적에 맞게 정해야 함 | 노드 추가·장애 때 캐시 미스가 늘 수 있고, 데이터 보존 기능이 없음 |

Redis의 명령 실행은 일반적으로 단일 스레드 이벤트 루프를 중심으로 이루어진다. 명령을 짧게 유지하는 Redis의 자료 구조 연산은 매우 효율적이지만, 큰 컬렉션을 한 번에 순회하거나 오래 실행되는 Lua 스크립트를 실행하면 다른 요청도 지연될 수 있다. Redis는 버전에 따라 네트워크 I/O를 위한 스레드를 지원하지만, 이 점만으로 명령 처리 특성이 완전히 같아지는 것은 아니다.

반대로 Memcached의 단순함이 기능 부족이라는 뜻은 아니다. 세션을 저장하면서 원자적 카운터도 필요하고, 장애 조치나 운영 도구를 한 시스템으로 통일하고 싶다면 Redis가 자연스럽다. 그 밖의 요구 없이 DB 조회 결과를 짧게 보관하는 용도라면 Memcached의 단순한 모델도 충분하다.

---

## 6. Spring에서 캐시 어사이드 적용하기

Spring Cache 추상화를 사용하면 애플리케이션 코드는 캐시 공급자에 강하게 묶이지 않고 캐시 어사이드를 적용할 수 있다. 다음 예제는 Redis를 캐시 저장소로 설정하고, 상품 조회 결과를 5분 동안 `products` 캐시에 저장한다.

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(5))
            .disableCachingNullValues();

        return RedisCacheManager.builder(connectionFactory)
            .cacheDefaults(defaults)
            .build();
    }
}
```

`@Cacheable`이 붙은 메서드는 먼저 캐시 키를 확인한다. 키가 없을 때만 메서드를 실행해 DB를 조회하고, 반환값을 캐시에 저장한다.

```java
@Service
@RequiredArgsConstructor
public class ProductQueryService {

    private final ProductRepository productRepository;

    @Cacheable(cacheNames = "products", key = "#productId")
    @Transactional(readOnly = true)
    public ProductResponse getProduct(Long productId) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new NoSuchElementException("상품이 없습니다."));

        return ProductResponse.from(product);
    }
}
```

상품을 변경한 뒤에는 기존 값을 제거해야 한다. 아래처럼 `@CacheEvict`를 사용하면 메서드가 정상적으로 끝났을 때 캐시를 비우는 흐름을 구성할 수 있다. DB 커밋 성공 뒤 무효화를 반드시 보장해야 하는 요구사항이라면 트랜잭션 완료 이벤트 등으로 시점을 명시적으로 설계한다. 캐시 어노테이션은 Spring 프록시를 통해 호출될 때 적용되므로 같은 클래스 내부에서 `this.getProduct()`처럼 호출하는 구조는 피해야 한다.

```java
@CacheEvict(cacheNames = "products", key = "#productId")
@Transactional
public void changePrice(Long productId, int newPrice) {
    Product product = productRepository.findById(productId)
        .orElseThrow(() -> new NoSuchElementException("상품이 없습니다."));

    product.changePrice(newPrice);
}
```

Memcached를 사용할 때도 이 흐름은 같다. Spring Cache의 Memcached 구현체나 사용하는 클라이언트 라이브러리에 맞춰 CacheManager를 연결하면 된다. 중요한 것은 제품 이름이 아니라, 조회 시 채우고 변경 시 무효화하며 TTL을 둔다는 일관된 정책이다.

---

## 7. 캐시를 운영할 때 자주 만나는 문제

### 캐시 스탬피드

인기 상품의 TTL이 동시에 끝나면 많은 요청이 한꺼번에 캐시 미스를 내고 모두 DB를 조회할 수 있다. 이를 **캐시 스탬피드(Cache Stampede)** 라고 한다. 키마다 TTL에 작은 무작위 값을 더해 만료 시점을 분산하고, 매우 비싼 조회에는 한 요청만 재생성하도록 락 또는 요청 합치기(request coalescing)를 적용하는 방법을 검토한다. 락을 도입할 때는 대기 시간과 장애 상황도 함께 설계해야 한다.

### 캐시 침투

존재하지 않는 상품 ID처럼 원본에도 없는 키가 반복 조회되면 캐시 미스가 계속 DB까지 전달된다. 짧은 TTL로 "없음" 결과를 캐시하거나, 입력값 검증과 허용 목록을 두어 방어할 수 있다. 다만 "없음"을 저장할 때는 새 데이터가 생성됐을 때 그 캐시도 무효화해야 한다.

### 메모리 축출과 큰 값

캐시는 메모리가 한정되어 있으므로 용량이 차면 오래되었거나 덜 사용된 항목 등이 축출될 수 있다. Redis는 `maxmemory`와 축출 정책을 명시적으로 정해야 하며, Memcached도 메모리 압박 상황에서 기존 항목을 내보낼 수 있다. 캐시 미스를 정상 동작으로 취급하고, 큰 객체·무제한 컬렉션·너무 긴 TTL을 피해야 한다.

### 장애와 관측

캐시 서버가 일시적으로 응답하지 않는다고 애플리케이션 전체가 멈추면 안 된다. 연결·명령 타임아웃을 짧고 명확하게 설정하고, 필요한 경우 제한된 범위에서 원본 저장소로 우회한다. 다만 캐시 장애 때 모든 요청을 DB로 보내면 DB까지 과부하될 수 있으므로, 동시 요청 제한과 부하 시험이 필요하다.

캐시 히트율, 캐시 미스 수, 메모리 사용량, 축출 수, 명령 지연 시간, 원본 DB의 조회량을 함께 관찰하자. 히트율이 높아도 큰 값의 직렬화 비용이나 네트워크 지연 때문에 효과가 작을 수 있으므로, 응답 시간과 DB 부하가 실제로 줄었는지 확인해야 한다.

---

## 8. 정리

Redis와 Memcached는 모두 원본 저장소의 읽기 부하를 줄이는 훌륭한 캐시 도구다. Redis는 자료 구조, 원자적 연산, 복제와 영속화 같은 기능이 필요할 때 적합하고, Memcached는 단순한 객체 캐시를 빠르고 명확하게 운영하고 싶을 때 잘 맞는다.

어느 도구를 선택하든 먼저 캐시 어사이드, TTL, 변경 뒤 무효화 규칙을 정해야 한다. 캐시 값은 언제든 사라지거나 오래될 수 있다는 전제에서 원본 데이터의 정합성을 지키고, 스탬피드·메모리 축출·장애 시 DB 부하까지 관측하며 운영하는 것이 더 중요하다.
