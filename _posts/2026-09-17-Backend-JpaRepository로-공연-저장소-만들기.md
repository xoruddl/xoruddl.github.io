---
layout: post
title: "JpaRepository 에 대한 간단한 이해"
date: 2026-09-17 11:13:26 +0900
categories: ["Backend"]
tags: ["spring-data-jpa", "jpa", "repository", "entity", "database"]
---

## 1. 개요

공연 예매 서비스에서 `Performance`는 공연 제목과 공연장 정보를 가진 엔티티다. 이 엔티티를 데이터베이스에 저장하거나 ID로 다시 찾으려면 SQL을 직접 작성할 수도 있지만, Spring Data JPA의 `JpaRepository`를 사용하면 기본적인 저장·조회·삭제 기능을 인터페이스 선언만으로 사용할 수 있다.

이 글에서는 `Performance` 엔티티와 `PerformanceRepository`를 예시로, `JpaRepository`가 무엇을 제공하는지와 서비스를 작성할 때의 기본 사용 방법을 정리한다.

---

## 2. 엔티티는 저장할 도메인 상태를 표현한다

먼저 데이터베이스에 저장할 공연을 엔티티로 정의한다. `@Entity`가 붙은 클래스는 JPA가 테이블의 한 행과 연결해 관리하는 객체다.

```java
package com.ticketing.booking.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Performance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String title;

    /** 공연장 이름. 예: 블루스퀘어 */
    private String venue;

    /** 제목·공연장은 비어 있을 수 없다. DB 오류가 아니라 만드는 시점에 이유를 드러낸다. */
    public Performance(String title, String venue) {
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("공연 제목은 비어 있을 수 없다");
        }
        if (venue == null || venue.isBlank()) {
            throw new IllegalArgumentException("공연장은 비어 있을 수 없다");
        }
        this.title = title;
        this.venue = venue;
    }
}
```

`@Id`는 엔티티를 구분하는 식별자이고, `@GeneratedValue(strategy = GenerationType.IDENTITY)`는 저장 시 데이터베이스가 ID 값을 생성하도록 맡긴다. 새 `Performance`를 만들 때는 아직 ID가 없지만, 영속화한 뒤에는 생성된 ID를 통해 같은 공연을 찾을 수 있다.

`@NoArgsConstructor(access = AccessLevel.PROTECTED)`는 JPA가 엔티티를 조회해 객체로 복원할 때 필요한 기본 생성자를 제공한다. Lombok은 이 애너테이션을 다음과 같은 코드로 만들어 준다.

```java
protected Performance() {
}
```

새 공연을 만드는 애플리케이션 코드는 제목과 공연장을 검증하는 생성자를 사용한다.

```java
Performance performance = new Performance("뮤지컬 위키드", "블루스퀘어");
```

반대로 JPA가 ID로 공연을 조회할 때는 생성자에 어떤 값을 넘겨야 할지 알 수 없다. 그래서 먼저 기본 생성자로 비어 있는 객체를 만들고, 데이터베이스에서 읽은 값을 필드에 채워 객체를 복원한다. 개념적인 흐름은 다음과 같다.

```text
1. JPA가 protected 기본 생성자로 빈 Performance 객체를 만든다.
2. DB에서 읽은 id, title, venue 값을 객체의 필드에 채운다.
3. 값이 모두 채워진 Performance 객체를 반환한다.
```

`protected`로 두면 다른 패키지의 일반 애플리케이션 코드는 `new Performance()`로 빈 객체를 만들 수 없다. 따라서 새 엔티티를 만들 때 검증 생성자를 사용하도록 유도할 수 있다. 다만 같은 패키지의 코드는 접근할 수 있으므로 빈 객체 생성을 완전히 막는 장치는 아니다. 핵심은 **기본 생성자는 JPA의 복원용으로, 인자가 있는 생성자는 유효한 새 객체를 만드는 용도로 역할을 나누는 것**이다.

생성자에서 제목과 공연장을 검증하는 점도 중요하다. 필수 값이 비어 있으면 DB의 `NOT NULL` 제약 조건 오류를 나중에 받는 대신, 객체를 생성하는 순간 도메인 규칙에 맞지 않는 이유를 알 수 있다. 데이터베이스 제약 조건은 별도로 두어 최종 방어선으로 삼는 것이 좋다.

---

## 3. `JpaRepository`는 엔티티의 기본 저장소를 만든다

저장소(repository)는 도메인 객체를 저장하고 다시 가져오는 역할을 맡는 인터페이스다. `PerformanceRepository`는 `JpaRepository`를 상속하는 것만으로 공연용 기본 저장소가 된다.

```java
package com.ticketing.booking.domain;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PerformanceRepository extends JpaRepository<Performance, Long> {
}
```

`JpaRepository<Performance, Long>`의 두 타입 인자는 다음을 뜻한다.

| 타입 인자 | 예시 | 의미 |
| --- | --- | --- |
| 첫 번째 | `Performance` | 이 저장소가 다루는 엔티티 타입 |
| 두 번째 | `Long` | 엔티티 식별자(`@Id`)의 타입 |

즉 이 선언은 "`Long` ID를 가진 `Performance`를 저장하고 조회하는 저장소"라는 계약이다. 구현 클래스를 직접 작성하지 않아도, 애플리케이션을 시작할 때 Spring Data JPA가 이 인터페이스의 구현체를 만들어 스프링 빈으로 등록한다.

---

## 4. 기본 CRUD 메서드를 바로 사용할 수 있다

`JpaRepository`는 `save`, `findById`, `findAll`, `deleteById` 같은 기본 메서드를 제공한다. 그래서 단순한 CRUD를 위해 SQL이나 구현 클래스를 먼저 만들 필요가 없다.

다음 코드는 공연을 저장한 뒤 생성된 ID로 다시 조회하는 예시다.

```java
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PerformanceService {

    private final PerformanceRepository performanceRepository;

    public PerformanceService(PerformanceRepository performanceRepository) {
        this.performanceRepository = performanceRepository;
    }

    @Transactional
    public Long create(String title, String venue) {
        Performance performance = new Performance(title, venue);
        Performance saved = performanceRepository.save(performance);
        return saved.getId();
    }

    @Transactional(readOnly = true)
    public Performance get(Long performanceId) {
        return performanceRepository.findById(performanceId)
            .orElseThrow(() -> new IllegalArgumentException("공연을 찾을 수 없다: " + performanceId));
    }
}
```

`save()`에 새 엔티티를 전달하면 JPA는 INSERT를 수행하고, 저장된 엔티티에 생성된 ID를 채운다. `findById()`의 반환 타입은 `Optional<Performance>`다. 존재하지 않는 ID를 조회할 수 있으므로, 호출하는 쪽에서 `orElseThrow()`처럼 없음의 처리를 명시해야 한다.

| 메서드 | 반환값 또는 동작 | 사용 예 |
| --- | --- | --- |
| `save(entity)` | 저장된 엔티티 반환 | 새 공연 저장 |
| `findById(id)` | `Optional<Performance>` 반환 | 특정 공연 조회 |
| `findAll()` | 모든 엔티티 목록 반환 | 관리 화면의 공연 목록 조회 |
| `existsById(id)` | 존재 여부 반환 | 참조할 공연이 있는지 확인 |
| `deleteById(id)` | 해당 ID의 엔티티 삭제 | 공연 삭제 |

서비스 메서드에 `@Transactional`을 붙인 이유는 저장·조회 같은 데이터베이스 작업의 경계를 서비스 유스케이스 단위로 관리하기 위해서다. 읽기 전용 조회에는 `readOnly = true`를 표시해 의도를 드러낼 수 있다. 다만 실제 최적화 방식은 JPA 구현체와 데이터베이스 설정에 따라 달라진다.

---

## 5. 테스트에서도 저장소로 데이터를 준비할 수 있다

아직 공연 등록 API가 없다면, 통합 테스트에서 저장소를 사용해 필요한 공연을 먼저 만들 수 있다.

```java
@SpringBootTest
class BookingServiceTest {

    @Autowired
    private PerformanceRepository performanceRepository;

    @Test
    void 공연을_저장한_뒤_ID로_조회한다() {
        Performance saved = performanceRepository.save(
            new Performance("뮤지컬 위키드", "블루스퀘어")
        );

        Performance found = performanceRepository.findById(saved.getId())
            .orElseThrow();

        assertThat(found.getTitle()).isEqualTo("뮤지컬 위키드");
        assertThat(found.getVenue()).isEqualTo("블루스퀘어");
    }
}
```

이 테스트에서 `save()`는 실제 테스트 데이터베이스에 공연을 넣고, `findById()`는 그 ID로 공연을 다시 읽는다. 테스트마다 데이터가 서로 영향을 주지 않도록, 프로젝트의 테스트 설정에 맞춰 트랜잭션 롤백이나 데이터 정리 전략도 함께 마련해야 한다.

---

## 6. 조회 규칙이 생길 때만 메서드를 추가한다

`JpaRepository`만으로 충분한 동안에는 빈 인터페이스를 유지해도 된다. 예를 들어 공연장 이름으로 공연을 찾는 요구가 실제로 생겼을 때, 메서드 이름으로 조회 규칙을 추가할 수 있다.

```java
public interface PerformanceRepository extends JpaRepository<Performance, Long> {

    List<Performance> findByVenue(String venue);
}
```

Spring Data JPA는 `findByVenue`라는 이름을 해석해 `venue` 필드를 조건으로 하는 조회를 만든다. 단, 메서드 이름이 지나치게 길어지거나 조인·집계·복잡한 조건이 필요해지면 이름 기반 쿼리만 고집하지 않는 편이 좋다. 이 경우에는 `@Query`, 명세(Specification), Querydsl 같은 방법을 검토해 조회 의도를 읽기 쉽게 유지한다.

---

## 7. 정리

`JpaRepository<Performance, Long>`는 `Performance` 엔티티와 그 `Long` 식별자를 연결한 저장소 계약이다. 이를 상속하면 저장, ID 조회, 목록 조회, 삭제 같은 기본 CRUD 기능을 구현 클래스 없이 사용할 수 있다.

`Performance`는 생성 시점에 제목과 공연장의 유효성을 보장하고, `PerformanceRepository`는 이 유효한 객체를 영속화하는 역할에 집중한다. 처음에는 기본 메서드만 사용하고, 실제 조회 요구가 생길 때만 저장소 메서드를 추가하면 도메인 코드와 데이터 접근 코드의 경계를 단순하게 유지할 수 있다.

---

## 8. 참고 자료

* [Spring Data JPA - JpaRepository API](https://docs.spring.io/spring-data/data-jpa/docs/current/api/org/springframework/data/jpa/repository/JpaRepository.html)
* [Spring Data JPA - JPA Query Methods](https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html)
